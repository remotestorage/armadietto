/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */
const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const spies = require('chai-spies');
chai.use(spies);
chai.use(require('chai-as-promised'));

const sandbox = chai.spy.sandbox();
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
    describe('when a valid access token is used', function () {
      afterEach(function () {
        sandbox.restore();
      });

      beforeEach(function () {
        sandbox.on(this.store, ['get']);
      });

      it('asks the store for the item', async function () {
        await get(this.app, '/storage/zebcoe/locog/seats');
        expect(this.store.get).to.have.been.called.with('zebcoe', '/locog/seats');
      });

      it('asks the store for items containing dots', async function () {
        await get(this.app, '/storage/zebcoe/locog/seats.gif');
        expect(this.store.get).to.have.been.called.with('zebcoe', '/locog/seats.gif');
      });

      it('asks the store for a deep item', async function () {
        await get(this.app, '/storage/zebcoe/deep/dir/value');
        expect(this.store.get).to.have.been.called.with('zebcoe', '/deep/dir/value');
      });

      it('passes the path literally to the store', async function () {
        await get(this.app, '/storage/zebcoe/locog/a%2Fpath');
        expect(this.store.get).to.have.been.called.with('zebcoe', '/locog/a%2Fpath');
      });

      it('ask the store for a directory listing', async function () {
        await get(this.app, '/storage/zebcoe/locog/');
        expect(this.store.get).to.have.been.called.with('zebcoe', '/locog/');
      });

      it('ask the store for a deep directory listing', async function () {
        await get(this.app, '/storage/zebcoe/deep/dir/');
        expect(this.store.get).to.have.been.called.with('zebcoe', '/deep/dir/');
      });

      it('doesn\'t ask the store for a root listing with unauthorized token', async function () {
        const res = await get(this.app, '/storage/zebcoe/');
        expect(this.store.get).not.to.have.been.called;
        expect(res).to.have.status(403);
      });

      it('ask the store for a root listing', async function () {
        await get(this.app, '/storage/zebcoe/').set('Authorization', 'Bearer root_token');
        expect(this.store.get).to.have.been.called.with('zebcoe', '/');
      });

      it('do not ask the store for an item in an unauthorized directory', async function () {
        await get(this.app, '/storage/zebcoe/jsconf/tickets');
        expect(this.store.get).not.to.have.been.called;
      });

      it('do not ask the store for an item in an too-broad directory', async function () {
        await get(this.app, '/storage/zebcoe/deep/nothing');
        expect(this.store.get).not.to.have.been.called;
      });

      it('do not ask the store for an unauthorized directory', async function () {
        await get(this.app, '/storage/zebcoe/deep/');
        expect(this.store.get).not.to.have.been.called;
      });

      it('do not ask the store for an item in a read-unauthorized directory', async function () {
        await get(this.app, '/storage/zebcoe/statues/first');
        expect(this.store.get).not.to.have.been.called;
      });

      it('do not ask the store for an item of another user', async function () {
        await get(this.app, '/storage/boris/locog/seats');
        expect(this.store.get).not.to.have.been.called;
      });
    });

    describe('when an invalid access token is used', function () {
      afterEach(function () {
        sandbox.restore();
      });

      beforeEach(function () {
        sandbox.on(this.store, ['get']);
      });

      it('does not ask the store for the item', async function () {
        await getWithBadToken(this.app, '/storage/zebcoe/locog/seats');
        expect(this.store.get).not.to.have.been.called;
      });

      it('asks the store for a public item', async function () {
        await getWithBadToken(this.app, '/storage/zebcoe/public/locog/seats');
        expect(this.store.get).to.have.been.called.with('zebcoe', '/public/locog/seats');
      });

      it('does not ask the store for a public directory', async function () {
        await getWithBadToken(this.app, '/storage/zebcoe/public/locog/seats/');
        expect(this.store.get).not.to.have.been.called;
      });

      it('returns an OAuth error', async function () {
        const res = await getWithBadToken(this.app, '/storage/zebcoe/locog/seats');
        expect(res).to.have.status(401);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        // expect(res.get('Cache-Control')).to.contain('private');
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
        expect(res).to.have.header('Content-Length', '7');
        expect(res).to.have.header('Content-Type', 'custom/type');
        expect(res).to.have.header('ETag', '"1330177020000"');
        expect(res.text).to.equal('a value');
      });

      it('returns a 304 for a failed conditional', async function () {
        this.store.content = 'a value';
        this.store.metadata = { contentType: 'custom/type', ETag: '"1330177020000"' };
        const res = await get(this.app, '/storage/zebcoe/locog/seats').set('If-None-Match', this.store.metadata.ETag);

        expect(res).to.have.status(304);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        // expect(res.get('Cache-Control')).to.contain('private');
        expect(res.get('Cache-Control')).to.contain('no-cache');
        expect(res).to.have.header('ETag', '"1330177020000"');
        expect(res.text).to.equal('');
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

    describe('when the item does not exist', function () {
      before(function () {
        this.store.content = this.store.metadata = this.store.children = null;
      });

      it('returns an empty 404 response', async function () {
        const res = await get(this.app, '/storage/zebcoe/locog/seats/');
        expect(res).to.have.status(404);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        // expect(res.text).to.equal('');
      });
    });

    describe('when the store returns an error', function () {
      before(function () {
        this.store.get = function () { throw new Error('We did something wrong'); };
      });

      it('returns a 500 response with the error message', async function () {
        const res = await get(this.app, '/storage/zebcoe/locog/seats/');
        expect(res).to.have.status(500);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res.text).to.contain('We did something wrong');
      });
    });
  });

  describe('PUT', function () {
    before(function () {
      sandbox.restore();
    });

    afterEach(function () {
      sandbox.restore();
    });

    beforeEach(function () {
      sandbox.on(this.store, ['put']);
    });

    describe('when a valid access token is used', function () {
      it('tells the store to save the given value', async function () {
        const content = 'a value';
        const res = await chai.request(this.app).put('/storage/zebcoe/locog/seats').buffer(true).type('text/plain')
          .set('Content-Length', content.length.toString()).set('Authorization', 'Bearer a_token').send(content);
        expect(this.store.put).to.have.been.called.once;
        expect(this.store.put).to.have.been.called.with('zebcoe', '/locog/seats', 'text/plain');
        expect(res.status).to.be.oneOf([200, 201, 204]);
        expect(res.text).to.equal('');
      });

      it('tells the store to save a public value', async function () {
        const res = await put(this.app, '/storage/zebcoe/public/locog/seats', 'a value');
        expect(this.store.put).to.have.been.called.with('zebcoe', '/public/locog/seats', 'text/plain');
        expect(res.status).to.be.oneOf([200, 201, 204]);
        expect(res.text).to.equal('');
      });

      // The signature of the old store method (but not the streaming store method) prevents from this working
      it.skip('tells the store to save a value conditionally based on If-None-Match (does match)', async function () {
        const content = 'a value';
        const ETag = '"f5f5f5f5f"';
        this.store.content = content;
        this.store.metadata = { contentType: 'text/plain', ETag };
        this.store.children = null;
        const res = await put(this.app, '/storage/zebcoe/locog/seats').buffer(true).type('text/plain')
          .set('Content-Length', content.length.toString())
          .set('Authorization', 'Bearer a_token')
          .set('If-None-Match', ETag)
          .send(content);
        expect(this.store.put).to.have.been.called.with('zebcoe', '/locog/seats',
          'text/plain');
        expect(res).to.have.status(412);
        expect(res.text).to.equal('');
        expect(res).to.have.header('Content-Length', '0');
      });

      // The signature of the old store method (but not the streaming store method) prevents from this working
      it.skip('tells the store to save a value conditionally based on If-None-Match (doesn\'t match)', async function () {
        const oldETag = '"a1b2c3d4"';
        this.store.content = 'old content';
        this.store.metadata = { contentType: 'text/plain', ETag: oldETag };
        this.store.children = null;
        const newContent = 'new content';
        const newETag = '"zzzzyyyyxxxx"';
        const res = await put(this.app, '/storage/zebcoe/locog/seats').buffer(true).type('text/plain')
          .set('Content-Length', newContent.length.toString())
          .set('Authorization', 'Bearer a_token')
          .set('If-None-Match', newETag)
          .send(newContent);
        expect(this.store.put).to.have.been.called.with('zebcoe', '/locog/seats', 'text/plain');
        expect(res.status).to.be.oneOf([200, 204]);
      });

      it('tells the store to create a value conditionally based on If-None-Match * (doesn\'t exist)', async function () {
        this.store.content = this.store.metadata = this.store.children = null;
        const content = 'a value';
        const res = await put(this.app, '/storage/zebcoe/locog/seats').buffer(true).type('text/plain')
          .set('Content-Length', content.length.toString())
          .set('Authorization', 'Bearer a_token')
          .set('If-None-Match', '*')
          .send(content);
        expect(this.store.put).to.have.been.called.with('zebcoe', '/locog/seats', 'text/plain');
        expect(res).to.have.status(201);
        expect(res.text).to.equal('');
      });

      it('tells the store to create a value conditionally based on If-None-Match * (does exist)', async function () {
        const oldETag = '"OldOldOld"';
        this.store.content = 'old content';
        this.store.metadata = { contentType: 'text/plain', ETag: oldETag };
        this.store.children = null;
        const content = 'a value';
        const res = await put(this.app, '/storage/zebcoe/locog/seats').buffer(true).type('text/plain')
          .set('Content-Length', content.length.toString())
          .set('Authorization', 'Bearer a_token')
          .set('If-None-Match', '*')
          .send(content);
        expect(this.store.put).to.have.been.called.with('zebcoe', '/locog/seats', 'text/plain');
        expect(res).to.have.status(412);
        expect(res.text).to.equal('');
      });

      it('tells the store to save a value conditionally based on If-Match (does match)', async function () {
        const oldETag = '"OldOldOld"';
        this.store.content = 'a value';
        this.store.metadata = { contentType: 'text/plain', ETag: oldETag };
        this.store.children = null;
        const content = 'a value';
        const res = await put(this.app, '/storage/zebcoe/locog/seats').buffer(true).type('text/plain')
          .set('Content-Length', content.length.toString())
          .set('Authorization', 'Bearer a_token')
          .set('If-Match', oldETag)
          .send(content);
        expect(this.store.put).to.have.been.called.with('zebcoe', '/locog/seats', 'text/plain');
        expect(res.status).to.be.oneOf([200, 204]);
        expect(res.text).to.equal('');
      });

      it('tells the store to save a value conditionally based on If-Match (doesn\'t match)', async function () {
        const oldETag = '"OldOldOld"';
        this.store.content = 'old value';
        this.store.metadata = { contentType: 'text/plain', ETag: oldETag };
        this.store.children = null;
        const content = 'new value';
        const res = await put(this.app, '/storage/zebcoe/locog/seats').buffer(true).type('text/plain')
          .set('Content-Length', content.length.toString())
          .set('Authorization', 'Bearer a_token')
          .set('If-Match', '"NewNewNew')
          .send(content);
        expect(this.store.put).to.have.been.called.with('zebcoe', '/locog/seats', 'text/plain');
        expect(res).to.have.status(412);
        expect(res.text).to.equal('');
      });

      it('does not tell the store to save a directory', async function () {
        const res = await put(this.app, '/storage/zebcoe/locog/seats/', 'a value');
        expect(this.store.put).not.to.have.been.called;
        expect(res).to.have.status(400);
        expect(res.text).to.equal('');
      });

      it('does not tell the store to save to a write-unauthorized directory', async function () {
        const res = await put(this.app, '/storage/zebcoe/books/house_of_leaves', 'a value');
        expect(this.store.put).not.to.have.been.called;
        expect(res).to.have.status(403);
        expect(res.text).to.equal('');
      });
    });

    describe('when an invalid access token is used', function () {
      it('does not tell the store to save the given value', async function () {
        await putWithBadToken(this.app, '/storage/zebcoe/locog/seats', 'a value');
        expect(this.store.put).not.to.have.been.called;
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

    describe('when the store says there was a version conflict', function () {
      before(function () {
        this.store.content = 'stored value';
        this.store.metadata = { contentType: 'text/html', ETag: '"ETag|stored value"' };
        this.store.children = null;
      });

      it('returns an empty 412 response', async function () {
        const res = await put(this.app, '/storage/zebcoe/locog/seats', 'new value').set('If-Match', 'ETag|some other value');
        expect(res).to.have.status(412);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res).to.have.header('ETag', '"ETag|stored value"');
        expect(res.text).to.equal('');
      });
    });

    describe('when the store returns an error', function () {
      before(function () {
        this.store.put = function () { throw new Error('Something is technically wrong'); };
      });

      it('returns a 500 response with the error message', async function () {
        const res = await put(this.app, '/storage/zebcoe/locog/seats', 'a value');
        expect(res).to.have.status(500);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res.text).to.contain('Something is technically wrong');
      });
    });
  });

  describe('DELETE', function () {
    afterEach(function () {
      sandbox.restore();
    });

    beforeEach(function () {
      this.store.content = this.store.metadata = this.store.children = null;
      sandbox.on(this.store, ['delete']);
    });

    it('tells the store to delete the given item unconditionally', async function () {
      this.store.content = 'old value';
      this.store.metadata = { ETag: '"ETag|old value' };
      const res = await del(this.app, '/storage/zebcoe/locog/seats');
      expect(this.store.delete).to.have.been.called.with('zebcoe', '/locog/seats', null);
      expect(res.status).to.be.oneOf([200, 204]);
      expect(res.text).to.equal('');
    });

    // The signature of the old store method (but not the streaming store method) prevents from this working
    it.skip('tells the store to delete an item conditionally based on If-None-Match (doesn\'t match)', async function () {
      this.store.content = 'old value';
      this.store.metadata = { ETag: '"ETag|old value' };
      const res = await del(this.app, '/storage/zebcoe/locog/seats')
        .set('If-None-Match', `"${modifiedTimestamp}"`);
      expect(this.store.delete).to.have.been.called.with('zebcoe', '/locog/seats');
      expect(res.status).to.be.oneOf([200, 204]);
      expect(res.text).to.equal('');
    });

    // The signature of the old store method (but not the streaming store method) prevents from this working
    it.skip('tells the store to delete an item conditionally based on If-None-Match (does match)', async function () {
      this.store.content = 'old value';
      this.store.metadata = { ETag: `"${modifiedTimestamp}"` };
      const res = await del(this.app, '/storage/zebcoe/locog/seats').set('If-None-Match', `"${modifiedTimestamp}"`);
      expect(this.store.delete).to.have.been.called.with('zebcoe', '/locog/seats');
      expect(res).to.have.status(412);
      expect(res.text).to.equal('');
    });

    it('tells the store to delete an item conditionally based on If-Match (doesn\'t match)', async function () {
      this.store.content = 'old value';
      this.store.metadata = { ETag: '"ETag|old value' };
      const res = await del(this.app, '/storage/zebcoe/locog/seats').set('If-Match', `"${modifiedTimestamp}"`);
      expect(this.store.delete).to.have.been.called.with('zebcoe', '/locog/seats');
      expect(res).to.have.status(412);
      expect(res.text).to.equal('');
    });

    it('tells the store to delete an item conditionally based on If-Match (does match)', async function () {
      this.store.content = 'old value';
      this.store.metadata = { ETag: `"${modifiedTimestamp}"` };
      const res = await del(this.app, '/storage/zebcoe/locog/seats').set('If-Match', `"${modifiedTimestamp}"`);
      expect(this.store.delete).to.have.been.called.with('zebcoe', '/locog/seats');
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

    describe('when the store returns an error', function () {
      beforeEach(function () {
        this.store.delete = function () { throw new Error('OH NOES!'); };
      });

      it('returns a 500 response with the error message', async function () {
        const res = await del(this.app, '/storage/zebcoe/locog/seats');
        expect(res).to.have.status(500);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res.text).to.contain('OH NOES!');
      });
    });
  });
};
