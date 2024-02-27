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

function put (app, path, params) {
  return chai.request(app).put(path).buffer(true).type('text/plain')
    .set('Authorization', 'Bearer a_token').send(params);
}

function del (app, path) {
  return chai.request(app).delete(path).set('Authorization', 'Bearer a_token');
}

/** This mock needs to implement conditionals, to test the code that generates responses */
const mockStore = {
  content: null,
  metadata: null,
  children: null,
  async get (_username, _path, condition) {
    let isBodyReturned;
    if (condition?.name === 'If-None-Match') {
      isBodyReturned = condition.ETag !== this.metadata?.ETag;
    } else if (condition?.name === 'If-Match') {
      isBodyReturned = condition.ETag === this.metadata?.ETag;
    } else { // unconditional
      isBodyReturned = Boolean(this.metadata);
    }

    let content, contentType;
    if (this.children) {
      content = JSON.stringify({
        '@context': 'http://remotestorage.io/spec/folder-description',
        ETag: this.metadata?.ETag,
        items: this.children
      });
      contentType = 'application/ld+json';
    } else {
      content = this.content || '';
      contentType = this.metadata?.contentType;
    }

    return {
      readStream: isBodyReturned ? Readable.from(content, { objectMode: false }) : null,
      contentLength: content?.length,
      contentType,
      ETag: this.metadata?.ETag // no ETag means no such file
    };
  },
  async put (_username, _path, contentType, readStream, condition) {
    if (condition?.name === 'If-None-Match' && condition?.ETag === '*') {
      if (this.metadata?.ETag) {
        return ['CONFLICT'];
      }
    } else if (condition?.name === 'If-None-Match') {
      if (condition?.ETag === this.metadata?.ETag) {
        return ['CONFLICT'];
      }
    } else if (condition?.name === 'If-Match') {
      if (condition?.ETag !== this.metadata?.ETag) {
        return ['CONFLICT', this.metadata?.ETag];
      }
    } // else unconditional

    const result = this.metadata?.ETag ? 'UPDATED' : 'CREATED';
    this.content = (await readStream.setEncoding('utf-8').toArray())[0];
    const ETag = `"ETag|${this.content}"`;
    this.metadata = { contentType, ETag };
    this.children = null;
    return [result, ETag];
  },
  async delete (_username, _path, condition) {
    if (condition?.name === 'If-None-Match') {
      if (condition?.ETag === this.metadata?.ETag) {
        return ['CONFLICT'];
      }
    } else if (condition?.name === 'If-Match') {
      if (condition?.ETag !== this.metadata?.ETag) {
        return ['CONFLICT', this.metadata?.ETag];
      }
    } // else unconditional
    if (this.metadata?.ETag) {
      this.content = this.metadata = this.children = null;
      return ['DELETED', `"ETag|${this.content}"`];
    } else { // didn't exist
      this.content = this.metadata = this.children = null;
      return ['NOT FOUND'];
    }
  },
  async permissions (user, token) {
    if (user === 'boris' && token === 'a_token') return false;
    if (user === 'zebcoe' && token === 'a_token') {
      return {
        '/locog/': ['r', 'w'],
        '/books/': ['r'],
        '/statuses/': ['w'],
        '/deep/': ['r', 'w']
      };
    }
    if (user === 'zebcoe' && token === 'root_token') return { '/': ['r', 'r'] };
    if (user === 'zebcoe' && token === 'bad_token') return false;
  }
};

const sandbox = chai.spy.sandbox();
const modifiedTimestamp = Date.UTC(2012, 1, 25, 13, 37).toString();

describe('Storage (modular)', function () {
  before(async function () {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['debug'] });

    this.store = mockStore;

    this.app = require('../../lib/app');
    this.app.set('streaming store', this.store);
    this.app.locals.title = 'Test Armadietto';
    this.app.locals.basePath = '';
    this.app.locals.host = 'localhost:xxxx';
    this.app.locals.signup = false;
  });

  describe('GET', function () {
    beforeEach(function () {
      sandbox.on(this.store, ['get']);
    });

    afterEach(function () {
      sandbox.restore();
    });

    describe('when a valid access token is used', function () {
      it('ask the store for an item conditionally based on If-None-Match', async function () {
        const ETag = '"1111aaaa2222"';
        await chai.request(this.app).get('/storage/zebcoe/locog/seats')
          .set('Authorization', 'Bearer a_token')
          .set('If-None-Match', ETag).send();
        expect(this.store.get).to.have.been.called.with('zebcoe', '/locog/seats', { name: 'If-None-Match', ETag });
      });
    });
  });

  describe('PUT', function () {
    beforeEach(function () {
      this.store.content = this.store.metadata = this.store.children = null;
      sandbox.on(this.store, ['put']);
    });

    afterEach(function () {
      sandbox.restore();
    });

    describe('when a valid access token is used', function () {
      it('tells the store to save a value conditionally based on If-None-Match (does match)', async function () {
        const content = 'a value';
        const ETag = '"f5f5f5f5f"';
        this.store.content = content;
        this.store.metadata = { contentType: 'text/plain', ETag };
        this.store.children = null;
        const res = await put(this.app, '/storage/zebcoe/locog/seats').buffer(true).type('text/plain')
          .set('Authorization', 'Bearer a_token')
          .set('If-None-Match', ETag)
          .send(content);
        expect(this.store.put).to.have.been.called.with('zebcoe', '/locog/seats',
          'text/plain');
        expect(res).to.have.status(412);
        expect(res.text).to.equal('');
        expect(res).to.have.header('Content-Length', '0');
      });

      it('tells the store to save a value conditionally based on If-None-Match (doesn\'t match)', async function () {
        const oldETag = '"a1b2c3d4"';
        this.store.content = 'old content';
        this.store.metadata = { contentType: 'text/plain', ETag: oldETag };
        this.store.children = null;
        const newContent = 'new content';
        const newETag = '"zzzzyyyyxxxx"';
        const res = await put(this.app, '/storage/zebcoe/locog/seats').buffer(true).type('text/plain')
          .set('Authorization', 'Bearer a_token')
          .set('If-None-Match', newETag)
          .send(newContent);
        expect(this.store.put).to.have.been.called.with('zebcoe', '/locog/seats', 'text/plain');
        expect(res.status).to.be.oneOf([200, 204]);
      });
    });
  });

  describe('DELETE', function () {
    beforeEach(function () {
      sandbox.on(this.store, ['delete']);
    });

    afterEach(function () {
      sandbox.restore();
    });

    it('tells the store to delete an item conditionally based on If-None-Match (doesn\'t match)', async function () {
      this.store.content = 'old value';
      this.store.metadata = { ETag: '"ETag|old value' };
      const res = await del(this.app, '/storage/zebcoe/locog/seats')
        .set('If-None-Match', `"${modifiedTimestamp}"`);
      expect(this.store.delete).to.have.been.called.with('zebcoe', '/locog/seats');
      expect(res.status).to.be.oneOf([200, 204]);
      expect(res.text).to.equal('');
    });

    it('tells the store to delete an item conditionally based on If-None-Match (does match)', async function () {
      this.store.content = 'old value';
      this.store.metadata = { ETag: `"${modifiedTimestamp}"` };
      const res = await del(this.app, '/storage/zebcoe/locog/seats').set('If-None-Match', `"${modifiedTimestamp}"`);
      expect(this.store.delete).to.have.been.called.with('zebcoe', '/locog/seats');
      expect(res).to.have.status(412);
      expect(res.text).to.equal('');
    });
  });

  shouldCrudBlobs();
});
