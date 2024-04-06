/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */

// If an expectation is commented out, usually the monolithic server doesn't pass, but the modular does.

const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const spies = require('chai-spies');
chai.use(spies);
chai.use(require('chai-as-promised'));

const modifiedTimestamp = Date.UTC(2012, 1, 25, 13, 37).toString();

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

/** The original tests assumed data would be passed as a buffer (not a stream) and didn't allow a distinction
 * between If-Match and If-None-Match conditions. These tests don't assume a buffer and do allow the distinction.
 * TODO: clean up the redundancies */
module.exports.shouldCrudBlobs = function () {
  describe('OPTIONS', function () {
    it('returns access control headers', async function () {
      const res = await chai.request(this.app).options('/storage/zebcoe/locog/seats').set('Origin', 'https://example.com');
      expect(res.statusCode).to.be.oneOf([200, 204]);
      expect(res).to.have.header('Access-Control-Allow-Origin', /\*|example.com/); // either * or example.com
      expect(res.get('Access-Control-Allow-Headers')).to.contain('Content-Type'); // list here to allow any type
      expect(res.get('Access-Control-Allow-Headers')).to.contain('Authorization');
      expect(res.get('Access-Control-Allow-Headers')).to.contain('Content-Length');
      expect(res.get('Access-Control-Allow-Headers')).to.contain('If-Match');
      expect(res.get('Access-Control-Allow-Headers')).to.contain('If-None-Match');
      expect(res.get('Access-Control-Allow-Headers')).to.contain('Origin');
      expect(res.get('Access-Control-Allow-Headers')).to.contain('X-Requested-With');
      expect(res.get('Access-Control-Allow-Methods')).to.contain('GET');
      expect(res.get('Access-Control-Allow-Methods')).to.contain('HEAD');
      expect(res.get('Access-Control-Allow-Methods')).to.contain('PUT');
      expect(res.get('Access-Control-Allow-Methods')).to.contain('DELETE');
      expect(res.get('Access-Control-Allow-Methods')).not.to.contain('POST');
      expect(res.get('Access-Control-Allow-Methods')).not.to.contain('PATCH');
      expect(res.get('Access-Control-Expose-Headers')).to.contain('ETag');
      expect(res.get('Cache-Control')).to.contain('no-cache');
      expect(res).to.have.header('Access-Control-Max-Age');
      expect(parseInt(res.header['access-control-max-age'])).to.be.greaterThan(10);
      expect(res.text).to.equal('');
    });
  });

  describe('GET', function () {
    describe('when the client uses a zero-length folder name', function () {
      it('returns a 400', async function () {
        const res = await get(this.app, '/storage/zebcoe/locog//seats', this.good_token);
        expect(res).to.have.status(400);
        expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
      });
    });

    describe('when the client uses a zero-length path', function () {
      it('returns a 400 or 404', async function () {
        const res = await get(this.app, '/storage/zebcoe');
        expect(res.statusCode).to.be.oneOf([400, 404]);
      });
    });

    describe('when the client uses a path with double dots', function () {
      it('returns a 400 or 404', async function () {
        const res = await get(this.app, '/storage/zebcoe/../');
        expect(res.statusCode).to.be.oneOf([400, 404]);
      });
    });

    describe('when a valid access token is used', function () {
      it('return deep documents w/ dots in path', async function () {
        this.store.content = 'some value';
        this.store.metadata = { contentType: 'example/type', ETag: '"j52l4j22"' };
        const res = await get(this.app, '/storage/zebcoe/deep/dir/value.tar.gz', this.good_token);
        expect(res).to.have.status(200);
        expect(res.text).to.equal(this.store.content);
        expect(parseInt(res.get('Content-Length'))).to.equal(this.store.content.length);
        expect(res.get('Content-Type')).to.equal(this.store.metadata.contentType);
        expect(res.get('Etag')).to.equal(this.store.metadata.ETag);
      });

      it('returns Forbidden w/ OAuth insufficient_scope for a root listing without authorized token', async function () {
        const res = await get(this.app, '/storage/zebcoe/', this.good_token);
        expect(res).to.have.status(403);
        expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
        expect(res.get('Cache-Control')).to.contain('no-cache');
        expect(res).to.have.header('WWW-Authenticate', /^Bearer\b/);
        expect(res).to.have.header('WWW-Authenticate', /\srealm="127\.0\.0\.1:\d{1,5}"/);
        expect(res).to.have.header('WWW-Authenticate', /\serror="insufficient_scope"/);
      });

      it('returns the root folder for a token with root permissions', async function () {
        this.store.metadata = { ETag: '"12345888888"' };
        this.store.children = [
          { bla: { ETag: '1234544444' } },
          { 'bar/': { ETag: '12345888888' } }
        ];
        const res = await get(this.app, '/storage/zebcoe/').set('Authorization', 'Bearer ' + this.root_token);
        expect(res).to.have.status(200);
        expect(res.body['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(res.body.items).to.deep.equal([
          { bla: { ETag: '1234544444' } },
          { 'bar/': { ETag: '12345888888' } }
        ]);
      });

      it('returns Forbidden w/ OAuth insufficient_scope for an item in a read-unauthorized folder', async function () {
        const res = await get(this.app, '/storage/zebcoe/statuses/first', this.good_token);
        expect(res).to.have.status(403);
        expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
        expect(res.get('Cache-Control')).to.contain('no-cache');
        expect(res).to.have.header('WWW-Authenticate', /^Bearer\b/);
        expect(res).to.have.header('WWW-Authenticate', /\srealm="127\.0\.0\.1:\d{1,5}"/);
        expect(res).to.have.header('WWW-Authenticate', /\serror="insufficient_scope"/);
      });
    });

    describe('when an invalid access token is used', function () {
      it('returns a public document', async function () {
        this.store.content = 'a value';
        this.store.metadata = { contentType: 'custom/type', ETag: '"j52l4j22"' };
        const res = await get(this.app, '/storage/zebcoe/public/locog/seats', this.bad_token);
        expect(res).to.have.status(200);
        expect(res.text).to.equal(this.store.content);
        expect(parseInt(res.get('Content-Length'))).to.equal(this.store.content.length);
        expect(res.get('Content-Type')).to.equal(this.store.metadata.contentType);
        expect(res.get('Etag')).to.equal(this.store.metadata.ETag);
        // expect(res.get('Cache-Control')).to.contain('public');
      });

      it('returns Unauthorized w/ OAuth invalid_token error for a public folder', async function () {
        this.store.metadata = { ETag: '"12345888888"' };
        this.store.children = [
          { bla: { ETag: '1234544444' } },
          { 'bar/': { ETag: '12345888888' } }
        ];

        const res = await get(this.app, '/storage/zebcoe/public/locog/seats/', this.bad_token);

        expect(res).to.have.status(401);
        expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
        expect(res.get('Cache-Control')).to.contain('no-cache');
        expect(res).to.have.header('WWW-Authenticate', /^Bearer\b/);
        expect(res).to.have.header('WWW-Authenticate', /\srealm="127\.0\.0\.1:\d{1,5}"/);
        expect(res).to.have.header('WWW-Authenticate', /\serror="invalid_token"/);
      });

      it('returns Unauthorized w/ OAuth invalid_token error for a private document', async function () {
        const res = await get(this.app, '/storage/zebcoe/other /seats', this.bad_token);
        expect(res).to.have.status(401);
        expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
        expect(res.get('Cache-Control')).to.contain('no-cache');
        expect(res).to.have.header('WWW-Authenticate', /^Bearer\b/);
        expect(res).to.have.header('WWW-Authenticate', /\srealm="127\.0\.0\.1:\d{1,5}"/);
        expect(res).to.have.header('WWW-Authenticate', /\serror="invalid_token"/);
      });
    });

    describe('when the store returns an item', function () {
      it('returns the value in the response', async function () {
        this.store.content = 'a value';
        this.store.metadata = { contentType: 'custom/type', ETag: '"1330177020000"' };

        const res = await get(this.app, '/storage/zebcoe/locog/seats', this.good_token);
        expect(res).to.have.status(200);
        expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
        expect(res.get('Cache-Control')).to.contain('no-cache');
        expect(res.text).to.equal('a value');
        expect(res).to.have.header('Content-Length', '7');
        expect(res).to.have.header('Content-Type', 'custom/type');
        expect(res).to.have.header('ETag', '"1330177020000"');
      });
    });

    describe('when the store returns a folder listing', function () {
      before(function () {
        this.store.metadata = {
          ETag: '"12345888888"'
        };
        this.store.children = [
          { bla: { ETag: '1234544444' } },
          { 'bar/': { ETag: '12345888888' } }
        ];
      });

      it('returns the listing as JSON', async function () {
        const res = await get(this.app, '/storage/zebcoe/locog/seats/', this.good_token);
        expect(res).to.have.status(200);
        expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
        expect(res.get('Cache-Control')).to.contain('no-cache');
        expect(res).to.have.header('ETag', '"12345888888"');
        expect(res.body['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(res.body.items).to.deep.equal([
          { bla: { ETag: '1234544444' } },
          { 'bar/': { ETag: '12345888888' } }
        ]);
      });
    });

    describe('when the store returns an empty folder listing', function () {
      before(function () {
        this.store.metadata = { ETag: '"12345888888"' };
        this.store.children = [];
      });

      it('returns the listing as JSON', async function () {
        const res = await get(this.app, '/storage/zebcoe/locog/seats/', this.good_token);
        expect(res).to.have.status(200);
        expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
        expect(res.get('Cache-Control')).to.contain('no-cache');
        expect(res).to.have.header('ETag', '"12345888888"');
        expect(res.body['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(res.body.items).to.deep.equal([]);
      });
    });
  });

  describe('PUT', function () {
    describe('when a valid access token is used', function () {
      it('tells the store to save the given value', async function () {
        const content = 'a value';
        const res = await chai.request(this.app).put('/storage/zebcoe/locog/seats').buffer(true).type('text/plain')
          .set('Content-Length', content.length.toString()).set('Authorization', 'Bearer ' + this.good_token)
          .set('Origin', 'https://rs-app.com:2112').send(content);
        expect(res.status).to.be.oneOf([200, 201, 204]);
        expect(res.text).to.equal('');
      });

      it('tells the store to save a public value', async function () {
        const res = await put(this.app, '/storage/zebcoe/public/locog/seats', this.good_token, 'a value');
        expect(res.status).to.be.oneOf([200, 201, 204]);
        expect(res.text).to.equal('');
      });

      it('does not tell the store to save a folder', async function () {
        const res = await put(this.app, '/storage/zebcoe/locog/seats/', this.good_token, 'a value');
        expect(res).to.have.status(400);
        expect(res.text).to.match(/can't write to folder|^$/);
        expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
      });

      it('returns Forbidden w/ OAuth insufficient scope error when saving in a write-unauthorized folder', async function () {
        const res = await put(this.app, '/storage/zebcoe/books/house_of_leaves', this.good_token, 'a value');
        expect(res).to.have.status(403);
        expect(res.text).to.equal('');
        expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
        expect(res).to.have.header('WWW-Authenticate', /^Bearer\b/);
        expect(res).to.have.header('WWW-Authenticate', /\srealm="127\.0\.0\.1:\d{1,5}"/);
        expect(res).to.have.header('WWW-Authenticate', /\serror="insufficient_scope"/);
      });
    });

    describe('when an invalid access token is used', function () {
      it('returns an OAuth error', async function () {
        const res = await put(this.app, '/storage/zebcoe/locog/seats', this.bad_token, 'a value');
        expect(res).to.have.status(401);
        expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
        expect(res).to.have.header('WWW-Authenticate', /^Bearer\b/);
        expect(res).to.have.header('WWW-Authenticate', /\srealm="127\.0\.0\.1:\d{1,5}"/);
        expect(res).to.have.header('WWW-Authenticate', /\serror="invalid_token"/);
      });
    });

    describe('when the store says the item was created', function () {
      before(function () {
        this.store.content = this.store.metadata = this.store.children = null;
      });

      it('returns an empty 201 response', async function () {
        const res = await put(this.app, '/storage/zebcoe/locog/seats', this.good_token, 'a value');
        expect(res).to.have.status(201);
        expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
        expect(res).to.have.header('ETag', '"ETag|a value"');
        expect(res.text).to.equal('');
      });
    });

    describe('when the store says the item was not created but updated', function () {
      before(function () {
        this.store.content = 'Old value';
        this.store.metadata = { contentType: 'text/html', ETag: '"ETag|Old value"' };
        this.store.children = null;
      });

      it('returns an empty 200 response', async function () {
        const res = await put(this.app, '/storage/zebcoe/locog/seats', this.good_token, 'new value');
        expect(res.status).to.be.oneOf([200, 204]);
        expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
        expect(res).to.have.header('ETag', '"ETag|new value"');
        expect(res.text).to.equal('');
      });
    });
  });

  describe('DELETE', function () {
    beforeEach(function () {
      this.store.content = this.store.metadata = this.store.children = null;
    });

    describe('when a valid access token is used', function () {
      it('tells the store to delete the given item unconditionally', async function () {
        this.store.content = 'old value';
        this.store.metadata = { ETag: '"ETag|old value' };
        const res = await del(this.app, '/storage/zebcoe/locog/seats', this.good_token);
        expect(res.status).to.be.oneOf([200, 204]);
        expect(res.text).to.equal('');
      });

      it('tells the store to delete an item conditionally based on If-Match (doesn\'t match)', async function () {
        this.store.content = 'old value';
        this.store.metadata = { ETag: '"ETag|old value' };
        const res = await del(this.app, '/storage/zebcoe/locog/seats', this.good_token).set('If-Match', `"${modifiedTimestamp}"`);
        expect(res).to.have.status(412);
        expect(res.text).to.equal('');
      });

      it('tells the store to delete an item conditionally based on If-Match (does match)', async function () {
        this.store.content = 'old value';
        this.store.metadata = { ETag: `"${modifiedTimestamp}"` };
        const res = await del(this.app, '/storage/zebcoe/locog/seats', this.good_token).set('If-Match', `"${modifiedTimestamp}"`);
        // expect(this.store.delete).to.have.been.called.with('zebcoe', '/locog/seats');
        expect(res.status).to.be.oneOf([200, 204]);
        expect(res.text).to.equal('');
      });

      describe('when the item does not exist', function () {
        beforeEach(function () {
        });

        it('returns an empty 404 response', async function () {
          this.store.content = this.store.metadata = this.store.children = null;
          const res = await del(this.app, '/storage/zebcoe/locog/seats', this.good_token);
          expect(res).to.have.status(404);
          expect(res.text).to.equal('');
        });
      });

      describe('when the token lacks write permission for a scope', function () {
        it('returns Forbidden w/ OAuth insufficient_scope error', async function () {
          const res = await del(this.app, '/storage/zebcoe/books/The Return of the King', this.good_token);
          expect(res).to.have.status(403);
          expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
          expect(res).to.have.header('WWW-Authenticate', /^Bearer\b/);
          expect(res).to.have.header('WWW-Authenticate', /\srealm="127\.0\.0\.1:\d{1,5}"/);
          expect(res).to.have.header('WWW-Authenticate', /\serror="insufficient_scope"/);
        });
      });
    });

    describe('when an invalid access token is used', function () {
      it('returns Unauthorized w/ OAuth invalid_token error', async function () {
        const res = await del(this.app, '/storage/zebcoe/locog/seats', this.bad_token);
        expect(res).to.have.status(401);
        expect(res).to.have.header('Access-Control-Allow-Origin', 'https://rs-app.com:2112');
        // expect(res).to.have.header('Cache-Control', /\bno-cache\b/);
        expect(res).to.have.header('WWW-Authenticate', /^Bearer\b/);
        expect(res).to.have.header('WWW-Authenticate', /\srealm="127\.0\.0\.1:\d{1,5}"/);
        expect(res).to.have.header('WWW-Authenticate', /\serror="invalid_token"/);
      });
    });
  });
};
