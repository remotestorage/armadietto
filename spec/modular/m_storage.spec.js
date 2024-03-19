/* eslint-env mocha, chai, node */

const { Readable } = require('node:stream');
const { configureLogger } = require('../../lib/logger');
const { shouldCrudBlobs } = require('../storage.spec');
const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const spies = require('chai-spies');
chai.use(spies);
chai.use(require('chai-as-promised'));
const express = require('express');
const { pipeline } = require('node:stream/promises');
const streamingStorageRouter = require('../../lib/routes/streaming_storage');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'swordfish';

/** This mock needs to implement conditionals, to test the code that generates responses */
const mockStoreRouter = express.Router();
mockStoreRouter.content = null;
mockStoreRouter.metadata = null;
mockStoreRouter.children = null;
mockStoreRouter.get('/:username/*',
  async function (req, res) {
    if (req.get('If-None-Match') && req.get('If-None-Match') === mockStoreRouter.metadata?.ETag) {
      res.status(304).end(); return;
    } else if (req.get('If-Match') && req.get('If-Match') !== mockStoreRouter.metadata?.ETag) {
      res.status(412).end(); return;
    }

    if (mockStoreRouter.metadata) {
      let content, contentType;
      if (req.url.endsWith('/')) {
        content = JSON.stringify({
          '@context': 'http://remotestorage.io/spec/folder-description',
          ETag: mockStoreRouter.metadata?.ETag,
          items: mockStoreRouter.children || []
        });
        contentType = 'application/ld+json';
      } else {
        content = mockStoreRouter.content;
        contentType = mockStoreRouter.metadata?.contentType;
      }

      res.status(200).set('Content-Length', content?.length || 0).set('Content-Type', contentType).set('ETag', mockStoreRouter.metadata?.ETag);
      return pipeline(Readable.from([content || ''], { objectMode: false }), res);
    } else {
      res.status(404).end();
    }
  }
);

mockStoreRouter.put('/:username/*',
  async function (req, res) {
    if (req.get('If-None-Match') === '*' && mockStoreRouter.metadata?.ETag) {
      res.status(412).end(); return;
    } else if (req.get('If-None-Match') && req.get('If-None-Match') === mockStoreRouter.metadata?.ETag) {
      res.status(412).end(); return;
    } else if (req.get('If-Match') && req.get('If-Match') !== mockStoreRouter.metadata?.ETag) {
      res.status(412).end(); return;
    } // else unconditional

    const statusCode = mockStoreRouter.metadata?.ETag ? 204 : 201;
    mockStoreRouter.content = (await req.setEncoding('utf-8').toArray())[0];
    const ETag = `"ETag|${mockStoreRouter.content}"`;
    mockStoreRouter.metadata = { contentType: req.get('Content-Type'), ETag };
    mockStoreRouter.children = null;
    res.status(statusCode).set('ETag', ETag).end();
  }
);

mockStoreRouter.delete('/:username/*',
  async function (req, res) {
    if (req.get('If-Match') && req.get('If-Match') !== mockStoreRouter.metadata?.ETag) {
      return res.status(412).end();
    } else if (req.get('If-None-Match') && req.get('If-None-Match') === mockStoreRouter.metadata?.ETag) {
      return res.status(412).end();
    }

    if (mockStoreRouter.metadata?.ETag) {
      res.status(204).set('ETag', `"ETag|${mockStoreRouter.content}"`).end();
    } else { // didn't exist
      res.status(404).end();
    }
    mockStoreRouter.content = mockStoreRouter.metadata = mockStoreRouter.children = null;
  }
);

function get (app, url, token) {
  return chai.request(app).get(url).set('Authorization', 'Bearer ' + token)
    .set('Origin', 'https://rs-app.com:2112').buffer(true);
}

function put (app, path, token, content) {
  return chai.request(app).put(path).buffer(true).type('text/plain')
    .set('Authorization', 'Bearer ' + token).set('Origin', 'https://rs-app.com:2112').send(content);
}

function del (app, path, token) {
  return chai.request(app).delete(path).set('Authorization', 'Bearer ' + token)
    .set('Origin', 'https://rs-app.com:2112');
}

describe('Storage (modular)', function () {
  before(async function () {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['debug'] });

    this.store = mockStoreRouter;

    this.hostIdentity = 'testhost';
    this.app = express();
    this.app.use('/storage', streamingStorageRouter(this.hostIdentity, JWT_SECRET));
    this.app.use('/storage', mockStoreRouter);
    this.app.locals.title = 'Test Armadietto';
    this.app.locals.basePath = '';
    this.app.locals.host = 'localhost:xxxx';
    this.app.locals.signup = false;

    this.good_token = jwt.sign(
      {
        scopes: 'locog:rw books:r statuses:w deep:rw'
      },
      JWT_SECRET,
      { algorithm: 'HS256', issuer: this.hostIdentity, audience: 'https://rs-app.com:2112', subject: 'zebcoe', expiresIn: '30d' }
    );
    this.root_token = jwt.sign(
      {
        scopes: 'root:rw'
      },
      JWT_SECRET,
      { algorithm: 'HS256', issuer: this.hostIdentity, audience: 'https://rs-app.com:2112', subject: 'zebcoe', expiresIn: '30d' }
    );
    this.bad_token = jwt.sign(
      {
        scopes: 'locog:rw books:r statuses:w deep:rw'
      },
      'some other secret',
      { algorithm: 'HS256', issuer: this.hostIdentity, audience: 'https://rs-app.com:2112', subject: 'zebcoe', expiresIn: '30d' }
    );
  });

  describe('GET (not implemented by file_tree)', function () {
    describe('when a valid access token is used', function () {
      it('returns Cache-Control: public for a public document', async function () {
        this.store.content = 'a value';
        this.store.metadata = { contentType: 'custom/type', ETag: '"j52l4j22"' };
        const res = await get(this.app, '/storage/zebcoe/public/locog/seats', this.bad_token);
        expect(res).to.have.status(200);
        expect(res.get('Cache-Control')).to.contain('public');
      });

      it('does not return Cache-Control: public for a public directory', async function () {
        this.store.content = 'a value';
        this.store.metadata = { contentType: 'custom/type', ETag: '"j52l4j22"' };
        const res = await get(this.app, '/storage/zebcoe/public/locog/seats/', this.bad_token);
        expect(res).to.have.status(401);
        expect(res.get('Cache-Control')).not.to.contain('public');
      });

      // scenario: ensure range is from same version
      it('returns Precondition Failed when If-Match is not equal', async function () {
        mockStoreRouter.content = 'fizbin';
        mockStoreRouter.metadata = { contentType: 'text/plain', ETag: '"current-etag"' };
        const res = await get(this.app, '/storage/zebcoe/locog/seats', this.good_token)
          .set('Origin', 'https://rs-app.com:2112').set('If-Match', '"different-etag"').send();
        expect(res).to.have.status(412);
        const retrievedContent = await res.setEncoding('utf-8').toArray();
        expect(retrievedContent).to.be.deep.equal([]);
      });

      // scenario: ensure range is from same version
      it('returns whole document when If-Match is equal', async function () {
        const ETag = '"l45l43k54j3lk"';
        const res = await get(this.app, '/storage/zebcoe/locog/seats', this.good_token)
          .set('If-Match', ETag).send();
        expect(res).to.have.status(412);
        const retrievedContent = await res.setEncoding('utf-8').toArray();
        expect(retrievedContent).to.be.deep.equal([]);
      });
    });
  });

  describe('PUT (not implemented by file_tree)', function () {
    beforeEach(function () {
      mockStoreRouter.content = mockStoreRouter.metadata = mockStoreRouter.children = null;
    });

    describe('when a valid access token is used', function () {
      // scenario: backup / sync
      it('creates when If-None-Match is ETag', async function () {
        const content = 'a value';
        const ETag = '"f5f5f5f5f"';
        const res = await put(this.app, '/storage/zebcoe/locog/seats', this.good_token).buffer(true).type('text/plain')
          .set('Authorization', 'Bearer ' + this.good_token)
          .set('If-None-Match', ETag)
          .send(content);
        expect(res).to.have.status(201);
        expect(res.text).to.equal('');
        expect(res).to.have.header('Content-Length', '0');
      });

      // scenario: backup / sync
      it('returns Precondition Failed when If-None-Match is equal', async function () {
        const content = 'a value';
        const ETag = '"f5f5f5f5f"';
        mockStoreRouter.content = content;
        mockStoreRouter.metadata = { contentType: 'text/plain', ETag };
        mockStoreRouter.children = null;
        const res = await put(this.app, '/storage/zebcoe/locog/seats').buffer(true).type('text/plain')
          .set('Authorization', 'Bearer ' + this.good_token)
          .set('If-None-Match', ETag)
          .send(content);
        expect(res).to.have.status(412);
        expect(res.text).to.equal('');
        expect(res).to.have.header('Content-Length', '0');
      });

      // newer backup / sync
      it('overwrites document when If-None-Match is not equal', async function () {
        const oldETag = '"a1b2c3d4"';
        mockStoreRouter.content = 'old content';
        mockStoreRouter.metadata = { contentType: 'text/plain', ETag: oldETag };
        mockStoreRouter.children = null;
        const newContent = 'new content';
        const newETag = '"zzzzyyyyxxxx"';
        const res = await put(this.app, '/storage/zebcoe/locog/seats').buffer(true).type('text/plain')
          .set('Authorization', 'Bearer ' + this.good_token)
          .set('If-None-Match', newETag)
          .send(newContent);
        expect(res.status).to.be.oneOf([204]);
      });
    });
  });

  describe('DELETE (not implemented by file_tree)', function () {
    beforeEach(function () {
      mockStoreRouter.content = mockStoreRouter.metadata = mockStoreRouter.children = null;
    });

    it('should not delete a document if the If-None-Match header is equal', async function () {
      mockStoreRouter.content = 'old value';
      mockStoreRouter.metadata = { ETag: '"ETag|old value' };
      const res = await del(this.app, '/storage/zebcoe/locog/seats', this.good_token)
        .set('If-None-Match', mockStoreRouter.metadata.ETag);
      expect(res.status).to.be.oneOf([412]);
      expect(res.text).to.equal('');
    });

    it('deletes a document if the If-None-Match header is not equal', async function () {
      mockStoreRouter.content = 'old value';
      mockStoreRouter.metadata = { ETag: '"ETag|old value"' };
      const res = await del(this.app, '/storage/zebcoe/locog/seats', this.good_token).set('If-None-Match', '"k5lj5l4jk"');
      expect(res).to.have.status(204);
      expect(res.text).to.equal('');
    });
  });

  describe('without JWT', function () {
    it('returns Unauthorized w/ OAuth realm & scope but no error', async function () {
      const res = await chai.request(this.app).get('/storage/zebcoe/statuses/')
        .set('Origin', 'https://rs-app.com:2112').buffer(true);
      expect(res).to.have.status(401);
      expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
      expect(res.get('Cache-Control')).to.contain('no-cache');
      expect(res).to.have.header('WWW-Authenticate', /^Bearer\b/);
      expect(res).to.have.header('WWW-Authenticate', /\srealm="127\.0\.0\.1:\d{1,5}"/);
      expect(res).to.have.header('WWW-Authenticate', /\sscope="statuses:r"/);
      expect(res).not.to.have.header('WWW-Authenticate', /\serror="/);
    });
  });
  shouldCrudBlobs();
});
