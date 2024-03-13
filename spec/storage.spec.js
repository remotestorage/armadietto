/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */
const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const spies = require('chai-spies');
chai.use(spies);
chai.use(require('chai-as-promised'));

const modifiedTimestamp = Date.UTC(2012, 1, 25, 13, 37).toString();

function get (app, url) {
  return chai.request(app).get(url).set('Authorization', 'Bearer a_token').buffer(true);
}

function getWithBadToken (app, url) {
  return chai.request(app).get(url).set('Authorization', 'Bearer bad_token');
}

function put (app, path, params) {
  return chai.request(app).put(path).buffer(true).type('text/plain')
    .set('Authorization', 'Bearer a_token').send(params);
}

function putWithBadToken (app, path, params) {
  return chai.request(app).put(path).buffer(true)
    .set('Authorization', 'Bearer bad_token').send(params);
}

function del (app, path) {
  return chai.request(app).delete(path).set('Authorization', 'Bearer a_token');
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
      // expect(res.get('Cache-Control')).to.contain('private');
      expect(res.get('Cache-Control')).to.contain('no-cache');
      expect(res).to.have.header('Access-Control-Max-Age');
      expect(parseInt(res.header['access-control-max-age'])).to.be.greaterThan(10);
      expect(res.text).to.equal('');
    });
  });

  describe('GET', function () {
    describe('when the client uses invalid chars in the path', function () {
      it('returns a 400', async function () {
        const res = await get(this.app, '/storage/zebcoe/locog/$eats');
        expect(res).to.have.status(400);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
      });
    });

    describe('when the client uses a zero-length path', function () {
      it('returns a 400 or 404', async function () {
        const res = await get(this.app, '/storage/zebcoe');
        expect(res.statusCode).to.be.oneOf([400, 404]);
      });
    });

    describe('when a valid access token is used', function () {
      it('return deep documents w/ dots in path', async function () {
        this.store.content = 'some value';
        this.store.metadata = { contentType: 'example/type', ETag: '"j52l4j22"' };
        const res = await get(this.app, '/storage/zebcoe/deep/dir/value.tar.gz');
        expect(res).to.have.status(200);
        expect(res.text).to.equal(this.store.content);
        expect(parseInt(res.get('Content-Length'))).to.equal(this.store.content.length);
        expect(res.get('Content-Type')).to.equal(this.store.metadata.contentType);
        expect(res.get('Etag')).to.equal(this.store.metadata.ETag);
      });

      it('returns Forbidden for a root listing without authorized token', async function () {
        const res = await get(this.app, '/storage/zebcoe/');
        expect(res).to.have.status(403);
      });

      it('returns the root folder for a token with root permissions', async function () {
        if (this.session) {
          this.session.permissions = { '/': ['r', 'r'] };
        }
        this.store.metadata = { ETag: '"12345888888"' };
        this.store.children = [
          { bla: { ETag: '1234544444' } },
          { 'bar/': { ETag: '12345888888' } }
        ];
        const res = await get(this.app, '/storage/zebcoe/').set('Authorization', 'Bearer root_token');
        expect(res).to.have.status(200);
        expect(res.body['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(res.body.items).to.deep.equal([
          { bla: { ETag: '1234544444' } },
          { 'bar/': { ETag: '12345888888' } }
        ]);
      });

      it('returns Forbidden for an item in a read-unauthorized directory', async function () {
        const res = await get(this.app, '/storage/zebcoe/statuses/first');
        // expect(this.store.get).not.to.have.been.called;
        expect(res).to.have.status(403);
      });
    });

    describe('when an invalid access token is used', function () {
      beforeEach(function () {
        if (this.session) { // modular server
          this.session.permissions = false;
        }
      });

      it('returns a public document', async function () {
        this.store.content = 'a value';
        this.store.metadata = { contentType: 'custom/type', ETag: '"j52l4j22"' };
        const res = await get(this.app, '/storage/zebcoe/public/locog/seats');
        expect(res).to.have.status(200);
        expect(res.text).to.equal(this.store.content);
        expect(parseInt(res.get('Content-Length'))).to.equal(this.store.content.length);
        expect(res.get('Content-Type')).to.equal(this.store.metadata.contentType);
        expect(res.get('Etag')).to.equal(this.store.metadata.ETag);
        // expect(res.get('Cache-Control')).to.contain('public');
      });

      it('returns an OAuth error for a public directory', async function () {
        this.store.metadata = { ETag: '"12345888888"' };
        this.store.children = [
          { bla: { ETag: '1234544444' } },
          { 'bar/': { ETag: '12345888888' } }
        ];

        const res = await getWithBadToken(this.app, '/storage/zebcoe/public/locog/seats/');

        expect(res).to.have.status(401);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res.get('Cache-Control')).to.contain('no-cache');
        expect(res).to.have.header('WWW-Authenticate', /Bearer realm="127\.0\.0\.1:\d{1,5}" error="invalid_token"/);
      });

      it('returns an OAuth error for a private document', async function () {
        const res = await getWithBadToken(this.app, '/storage/zebcoe/other /seats');
        expect(res).to.have.status(401);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res.get('Cache-Control')).to.contain('no-cache');
        expect(res).to.have.header('WWW-Authenticate', /Bearer realm="127\.0\.0\.1:\d{1,5}" error="invalid_token"/);
      });
    });

    describe('when the store returns an item', function () {
      it('returns the value in the response', async function () {
        this.store.content = 'a value';
        this.store.metadata = { contentType: 'custom/type', ETag: '"1330177020000"' };

        const res = await get(this.app, '/storage/zebcoe/locog/seats');
        expect(res).to.have.status(200);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        // expect(res.get('Cache-Control')).to.contain('private');
        expect(res.get('Cache-Control')).to.contain('no-cache');
        expect(res.text).to.equal('a value');
        expect(res).to.have.header('Content-Length', '7');
        expect(res).to.have.header('Content-Type', 'custom/type');
        expect(res).to.have.header('ETag', '"1330177020000"');
      });
    });

    describe('when the store returns a directory listing', function () {
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
        const res = await get(this.app, '/storage/zebcoe/locog/seats/');
        expect(res).to.have.status(200);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        // expect(res.get('Cache-Control')).to.contain('private');
        expect(res.get('Cache-Control')).to.contain('no-cache');
        expect(res).to.have.header('ETag', '"12345888888"');
        expect(res.body['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(res.body.items).to.deep.equal([
          { bla: { ETag: '1234544444' } },
          { 'bar/': { ETag: '12345888888' } }
        ]);
      });
    });

    describe('when the store returns an empty directory listing', function () {
      before(function () {
        this.store.metadata = { ETag: '"12345888888"' };
        this.store.children = [];
      });

      it('returns the listing as JSON', async function () {
        const res = await get(this.app, '/storage/zebcoe/locog/seats/');
        expect(res).to.have.status(200);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        // expect(res.get('Cache-Control')).to.contain('private');
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
          .set('Content-Length', content.length.toString()).set('Authorization', 'Bearer a_token').send(content);
        expect(res.status).to.be.oneOf([200, 201, 204]);
        expect(res.text).to.equal('');
      });

      it('tells the store to save a public value', async function () {
        const res = await put(this.app, '/storage/zebcoe/public/locog/seats', 'a value');
        expect(res.status).to.be.oneOf([200, 201, 204]);
        expect(res.text).to.equal('');
      });

      it('does not tell the store to save a directory', async function () {
        const res = await put(this.app, '/storage/zebcoe/locog/seats/', 'a value');
        expect(res).to.have.status(400);
        expect(res.text).to.equal('');
      });

      it('does not tell the store to save to a write-unauthorized directory', async function () {
        const res = await put(this.app, '/storage/zebcoe/books/house_of_leaves', 'a value');
        expect(res).to.have.status(403);
        expect(res.text).to.equal('');
      });
    });

    describe('when an invalid access token is used', function () {
      beforeEach(function () {
        if (this.session) { // modular server
          this.session.permissions = false;
        }
      });

      it('does not tell the store to save the given value', async function () {
        const res = await putWithBadToken(this.app, '/storage/zebcoe/locog/seats', 'a value');
        // expect(this.store.put).not.to.have.been.called;
        expect(res).to.have.status(401);
      });
    });

    describe('when the store says the item was created', function () {
      before(function () {
        this.store.content = this.store.metadata = this.store.children = null;
      });

      it('returns an empty 201 response', async function () {
        const res = await put(this.app, '/storage/zebcoe/locog/seats', 'a value');
        expect(res).to.have.status(201);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
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
        const res = await put(this.app, '/storage/zebcoe/locog/seats', 'new value');
        expect(res.status).to.be.oneOf([200, 204]);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res).to.have.header('ETag', '"ETag|new value"');
        expect(res.text).to.equal('');
      });
    });
  });

  describe('DELETE', function () {
    beforeEach(function () {
      this.store.content = this.store.metadata = this.store.children = null;
    });

    it('tells the store to delete the given item unconditionally', async function () {
      this.store.content = 'old value';
      this.store.metadata = { ETag: '"ETag|old value' };
      const res = await del(this.app, '/storage/zebcoe/locog/seats');
      // expect(this.store.delete).to.have.been.called.with('zebcoe', '/locog/seats', null);
      expect(res.status).to.be.oneOf([200, 204]);
      expect(res.text).to.equal('');
    });

    it('tells the store to delete an item conditionally based on If-Match (doesn\'t match)', async function () {
      this.store.content = 'old value';
      this.store.metadata = { ETag: '"ETag|old value' };
      const res = await del(this.app, '/storage/zebcoe/locog/seats').set('If-Match', `"${modifiedTimestamp}"`);
      // expect(this.store.delete).to.have.been.called.with('zebcoe', '/locog/seats');
      expect(res).to.have.status(412);
      expect(res.text).to.equal('');
    });

    it('tells the store to delete an item conditionally based on If-Match (does match)', async function () {
      this.store.content = 'old value';
      this.store.metadata = { ETag: `"${modifiedTimestamp}"` };
      const res = await del(this.app, '/storage/zebcoe/locog/seats').set('If-Match', `"${modifiedTimestamp}"`);
      // expect(this.store.delete).to.have.been.called.with('zebcoe', '/locog/seats');
      expect(res.status).to.be.oneOf([200, 204]);
      expect(res.text).to.equal('');
    });

    describe('when the item does not exist', function () {
      beforeEach(function () {
      });

      it('returns an empty 404 response', async function () {
        this.store.content = this.store.metadata = this.store.children = null;
        const res = await del(this.app, '/storage/zebcoe/locog/seats');
        expect(res).to.have.status(404);
        expect(res.text).to.equal('');
      });
    });
  });
};
