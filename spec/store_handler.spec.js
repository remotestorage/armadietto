/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-spies'));
chai.use(require('chai-as-promised'));
const httpMocks = require('node-mocks-http');
const { Readable } = require('node:stream');
const { open } = require('node:fs/promises');
const path = require('path');
const longString = require('./util/longString');
const LongStream = require('./util/LongStream');

async function waitForEnd (response) {
  return new Promise(resolve => {
    setTimeout(checkEnd, 100);
    function checkEnd () {
      if (response._isEndCalled()) {
        resolve();
      } else {
        setTimeout(checkEnd, 100);
      }
    }
  });
}

module.exports.shouldStoreStreams = function () {
  before(async function () {
    this.timeout(15_000);

    this.doHandle = async reqOpts => {
      const req = Object.assign(reqOpts.body instanceof Readable
        ? reqOpts.body
        : Readable.from([reqOpts.body], { objectMode: false }), reqOpts);
      req.originalUrl ||= req.url;
      req.baseUrl ||= req.url;
      req.headers = {};
      for (const [key, value] of Object.entries(reqOpts.headers || {})) {
        req.headers[key.toLowerCase()] = String(value);
      }
      req.get = headerName => req.headers[headerName?.toLowerCase()];
      req.query ||= {};
      req.files ||= {};
      req.socket ||= {};
      req.ips = [req.ip = '127.0.0.1'];

      const res = httpMocks.createResponse({ req });
      res.req = req;
      req.res = res;
      const next = chai.spy(err => {
        let status;
        if (err.Code === 'SlowDown') {
          status = err.$metadata?.httpStatusCode;
        }
        if (!status) {
          status = (err?.stack || err) + (err.cause ? '\n' + err.cause : '');
        }
        res.status(status).end();
      });

      await this.handler(req, res, next);
      await waitForEnd(res);

      return [res, next];
    };

    this.username = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    await this.store.createUser({ username: this.username, email: 'l@m.no', password: '12345678' });
  });

  after(async function () {
    this.timeout(360_000);
    await this.store.deleteUser(this.username);
  });

  describe('GET', function () {
    this.timeout(30_000);

    describe('for files', function () {
      describe('unversioned', function () {
        it('returns Not Found for a non-existing path', async function () {
          const [res, next] = await this.doHandle({
            method: 'GET',
            url: `/${this.username}/non-existing/non-existing`
          });

          expect(res.statusCode).to.equal(404);
          expect(res._getBuffer().toString()).to.equal('');
          expect(Boolean(res.get('Content-Length'))).to.be.false;
          expect(Boolean(res.get('Content-Type'))).to.be.false;
          expect(Boolean(res.get('ETag'))).to.be.false;
          expect(next).not.to.have.been.called;
        });

        it('returns Not Found for a non-existing path in an existing category', async function () {
          const content = 'filename';
          const [putRes] = await this.doHandle({
            method: 'PUT',
            url: `/${this.username}/existing/document`,
            headers: { 'Content-Length': content.length, 'Content-Type': 'text/cache-manifest' },
            body: content
          });
          expect(putRes.statusCode).to.equal(201);
          expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
          expect(putRes._getBuffer().toString()).to.equal('');

          const [res, next] = await this.doHandle({
            method: 'GET',
            url: `/${this.username}/existing/not-existing`
          });
          expect(res.statusCode).to.equal(404);
          expect(res._getBuffer().toString()).to.equal('');
          expect(Boolean(res.get('Content-Length'))).to.be.false;
          expect(Boolean(res.get('Content-Type'))).to.be.false;
          expect(Boolean(res.get('ETag'))).to.be.false;
          expect(next).not.to.have.been.called;
        });
      });

      describe('versioned', function () {
        it('should return file for If-None-Match with old ETag', async function () {
          const content = 'VEVENT';
          const [putRes] = await this.doHandle({
            method: 'PUT',
            url: `/${this.username}/existing/file`,
            headers: { 'Content-Length': content.length, 'Content-Type': 'text/calendar' },
            body: content
          });
          expect(putRes.statusCode).to.equal(201);
          expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
          expect(putRes._getBuffer().toString()).to.equal('');

          const [res, next] = await this.doHandle({
            method: 'GET',
            url: `/${this.username}/existing/file`,
            headers: { 'If-None-Match': '"l5j3lk5j65lj3"' }
          });

          expect(res.statusCode).to.equal(200);
          expect(res._getBuffer().toString()).to.equal(content);
          expect(res.get('Content-Length')).to.equal(String(content.length));
          expect(res.get('Content-Type')).to.equal('text/calendar');
          expect(res.get('ETag')).to.equal(putRes.get('ETag'));
          expect(next).not.to.have.been.called;
        });

        it('should return Not Modified for If-None-Match with matching ETag', async function () {
          const content = 'VEVENT';
          const [putRes] = await this.doHandle({
            method: 'PUT',
            url: `/${this.username}/existing/thing`,
            headers: { 'Content-Length': content.length, 'Content-Type': 'text/plain' },
            body: content
          });
          expect(putRes.statusCode).to.equal(201);
          expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
          expect(putRes._getBuffer().toString()).to.equal('');

          const [res, next] = await this.doHandle({
            method: 'GET',
            url: `/${this.username}/existing/thing`,
            headers: { 'If-None-Match': putRes.get('ETag') }
          });

          expect(res.statusCode).to.equal(304);
          expect(res._getBuffer().toString()).to.equal('');
          expect(Boolean(res.get('Content-Length'))).to.be.false;
          expect(Boolean(res.get('Content-Type'))).to.be.false;
          expect(Boolean(res.get('ETag'))).to.be.false;
          expect(next).not.to.have.been.called;
        });

        it('should return file for If-Match with matching ETag', async function () {
          const content = 'VEVENT';
          const [putRes] = await this.doHandle({
            method: 'PUT',
            url: `/${this.username}/existing/novel`,
            headers: { 'Content-Length': content.length, 'Content-Type': 'text/calendar' },
            body: content
          });
          expect(putRes.statusCode).to.equal(201);
          expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
          expect(putRes._getBuffer().toString()).to.equal('');

          const [res, next] = await this.doHandle({
            method: 'GET',
            url: `/${this.username}/existing/novel`,
            headers: { 'If-Match': putRes.get('ETag') }
          });

          expect(res.statusCode).to.equal(200);
          expect(res._getBuffer().toString()).to.equal(content);
          expect(res.get('Content-Length')).to.equal(String(content.length));
          expect(res.get('Content-Type')).to.equal('text/calendar');
          expect(res.get('ETag')).to.equal(putRes.get('ETag'));
          expect(next).not.to.have.been.called;
        });

        it('should return Precondition Failed for If-Match with mismatched ETag', async function () {
          const content = 'VEVENT';
          const [putRes] = await this.doHandle({
            method: 'PUT',
            url: `/${this.username}/existing/short-story`,
            headers: { 'Content-Length': content.length, 'Content-Type': 'text/plain' },
            body: content
          });
          expect(putRes.statusCode).to.equal(201);
          expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
          expect(putRes._getBuffer().toString()).to.equal('');

          const [res, next] = await this.doHandle({
            method: 'GET',
            url: `/${this.username}/existing/short-story`,
            headers: { 'If-Match': '"6kjl35j6365k"' }
          });

          expect(res.statusCode).to.equal(412);
          expect(res._getBuffer().toString()).to.equal('');
          expect(Boolean(res.get('Content-Length'))).to.be.false;
          expect(Boolean(res.get('Content-Type'))).to.be.false;
          expect(Boolean(res.get('ETag'))).to.be.false;
          expect(next).not.to.have.been.called;
        });
      });
    });

    describe('for directories', function () {
      it('returns listing with no items for a non-existing category', async function () {
        const [res, next] = await this.doHandle({
          method: 'GET',
          url: `/${this.username}/non-existing-category/`
        });

        expect(res.statusCode).to.equal(200);
        expect(res.get('Content-Type')).to.equal('application/ld+json');
        const directory = res._getJSONData();
        expect(directory['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(directory.items).to.deep.equal({});
        expect(res.get('ETag')).to.match(/^"[#-~!]{6,128}"$/);
        expect(next).not.to.have.been.called;
      });

      it('returns listing with no items for a non-existing folder in non-existing category', async function () {
        const [res, next] = await this.doHandle({
          method: 'GET',
          url: `/${this.username}/non-existing-category/non-existing-directory/`
        });

        expect(res.statusCode).to.equal(200);
        expect(res.get('Content-Type')).to.equal('application/ld+json');
        const directory = res._getJSONData();
        expect(directory['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(directory.items).to.deep.equal({});
        expect(res.get('ETag')).to.match(/^"[#-~!]{6,128}"$/);
        expect(next).not.to.have.been.called;
      });

      it('returns JSON-LD unconditionally & Not Modified when If-None-Match has a matching ETag', async function () {
        const content1 = 'yellow, red';
        const [putRes1] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/color-category/color-directory/yellow-red`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/csv' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'blue & green';
        const [putRes2] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/color-category/color-directory/blue-green`,
          headers: { 'Content-Length': content2.length, 'Content-Type': 'text/n3' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(201);
        expect(putRes2.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes2._getBuffer().toString()).to.equal('');

        const content3 = 'purple -> ultraviolet';
        const [putRes3] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/color-category/color-directory/subfolder/purple-ultraviolet`,
          headers: { 'Content-Length': content3.length, 'Content-Type': 'text/plain' },
          body: content3
        });
        expect(putRes3.statusCode).to.equal(201);
        expect(putRes3.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes3._getBuffer().toString()).to.equal('');

        const [getRes1] = await this.doHandle({
          method: 'GET',
          url: `/${this.username}/color-category/color-directory/`
        });
        expect(getRes1.statusCode).to.equal(200);
        expect(getRes1.get('Content-Type')).to.equal('application/ld+json');
        expect(getRes1.get('ETag')).to.match(/^".{6,128}"$/);
        const directory = JSON.parse(getRes1._getBuffer().toString());
        expect(directory['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(directory.items['yellow-red'].ETag).to.equal(putRes1.get('ETag'));
        expect(directory.items['yellow-red']['Content-Type']).to.equal('text/csv');
        expect(directory.items['yellow-red']['Content-Length']).to.equal(content1.length);
        expect(Date.now() - new Date(directory.items['yellow-red']['Last-Modified'])).to.be.lessThan(9_000);
        expect(directory.items['blue-green'].ETag).to.equal(putRes2.get('ETag'));
        expect(directory.items['blue-green']['Content-Type']).to.equal('text/n3');
        expect(directory.items['blue-green']['Content-Length']).to.equal(content2.length);
        expect(Date.now() - new Date(directory.items['blue-green']['Last-Modified'])).to.be.lessThan(9_000);
        expect(directory.items['subfolder/'].ETag).to.match(/^".{6,128}"$/);

        const [getRes2] = await this.doHandle({
          method: 'GET',
          url: `/${this.username}/color-category/color-directory/`,
          headers: { 'If-None-Match': getRes1.get('ETag') }
        });
        expect(getRes2.statusCode).to.equal(304);
        expect(getRes2._getBuffer().toString()).to.equal('');
      });

      it('returns directory when If-None-Match has an old ETag', async function () {
        const content = 'mud';
        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/fill-category/fill-directory/mud`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/vnd.qq' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [getRes] = await this.doHandle({
          method: 'GET',
          url: `/${this.username}/fill-category/fill-directory/`,
          headers: { 'If-None-Match': '"l6l56jl5j6lkl63jkl6jk"' }
        });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes.get('Content-Type')).to.equal('application/ld+json');
        expect(getRes.get('ETag')).to.match(/^".{6,128}"$/);
        const directory = JSON.parse(getRes._getBuffer().toString());
        expect(directory['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(directory.items.mud.ETag).to.equal(putRes.get('ETag'));
        expect(directory.items.mud['Content-Type']).to.equal('text/vnd.qq');
        expect(directory.items.mud['Content-Length']).to.equal(content.length);
        expect(Date.now() - new Date(directory.items.mud['Last-Modified'])).to.be.lessThan(9_000);
      });
    });
  });

  describe('PUT', function () {
    this.timeout(30_000);

    describe('unversioned', function () {
      it('does not create a file for a bad user name', async function () {
        const content = 'microbe';
        const req = httpMocks.createRequest({ method: 'PUT', url: '/@@@/not-created/non-existent/user', body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        const next = chai.spy();

        await this.handler(req, res, next);

        expect(next).to.have.been.called;
      });

      it('does not create a file for a bad path', async function () {
        const content = 'microbe';
        const req = httpMocks.createRequest({ method: 'PUT', url: `/${this.username}//`, body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        const next = chai.spy();

        await this.handler(req, res, next);

        expect(next).to.have.been.called;
      });

      it('responds with Conflict for folder', async function () {
        const content = 'thing';
        const [res, next] = await this.doHandle({ method: 'PUT', url: `/${this.username}/not-created/`, body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });

        expect(res.statusCode).to.equal(409);
        expect(res._getBuffer().toString()).to.equal('');
        expect(next).not.to.have.been.called;
      });

      // TODO: should there be a clearer message?
      // A nonexistent user here means storage has been deleted but the account still exists.
      it('does not create a file for a nonexistant user', async function () {
        const content = 'microbe';
        const req = httpMocks.createRequest({ method: 'PUT', url: '/non-existent-user/not-created/non-existent/user', body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        const next = chai.spy();

        await this.handler(req, res, next);

        expect(next).to.have.been.called;
      });

      it('does not create a file for an empty path', async function () {
        const content = 'microbe';
        const req = httpMocks.createRequest({ method: 'PUT', url: `/${this.username}/`, body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        const next = chai.spy();

        await this.handler(req, res, next);

        expect(next).to.have.been.called;
      });

      it('does not create a file for a path with a bad character', async function () {
        const content = 'microbe';
        const req = httpMocks.createRequest({ method: 'PUT', url: `/${this.username}/foo\0bar`, body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        const next = chai.spy();

        await this.handler(req, res, next);

        expect(next).to.have.been.called;
      });

      it('does not create a file for a path with a bad element', async function () {
        const content = 'microbe';
        const req = httpMocks.createRequest({ method: 'PUT', url: `/${this.username}/foo/../bar`, body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        const next = chai.spy();

        await this.handler(req, res, next);

        expect(next).to.have.been.called;
      });

      it('sets the value of an item', async function () {
        const content = 'vertibo';
        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/photos/zipwire`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'image/poster' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/photos/zipwire` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('image/poster');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));
      });

      it('sets the value of an item, without length', async function () {
        const content = 'vertibo';
        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/photos/summer`,
          headers: { 'Content-Type': 'image/poster' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/photos/summer` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('image/poster');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));
      });

      it('set the type to application/binary if no type passed', async function () {
        const content = 'um num num';
        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/no-type/doc`,
          headers: { 'Content-Length': content.length },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/no-type/doc` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('application/binary');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));
      });

      it('stores binary data', async function () {
        const fileHandle = await open(path.join(__dirname, 'whut2.jpg'));
        const stat = await fileHandle.stat();
        const fileStream = fileHandle.createReadStream();
        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/photos/election`,
          headers: { 'Content-Length': stat.size, 'Content-Type': 'image/jpeg' },
          body: fileStream
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');
        await fileHandle.close();

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/photos/election` });
        expect(getRes.statusCode).to.equal(200);
        // expect(putRes._getBuffer().length).to.equal(stat.size);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(stat.size);
        expect(getRes.get('Content-Type')).to.equal('image/jpeg');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));
        // const totalSize = (await readStream.toArray()).reduce((acc, curr) => acc + curr.length, 0);
        // expect(totalSize).to.equal(stat.size);
      });

      it('sets the value of a public item', async function () {
        const content = 'vertibo';
        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/public/photos/zipwire2`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'image/poster' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/public/photos/zipwire2` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('image/poster');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));

        const [getRes2] = await this.doHandle({ method: 'GET', url: `/${this.username}/photos/zipwire2` });
        expect(getRes2.statusCode).to.equal(404);
        expect(getRes2._getBuffer().toString()).to.equal('');
      });

      it('sets the value of a root item', async function () {
        const content = 'gizmos';
        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/manifesto`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/plain' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/manifesto` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('text/plain');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));
      });

      it('updates the value of an item', async function () {
        const content1 = 'abracadabra';
        const [putRes1] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/magic/sterotypical`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/vnd.abc' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'alakazam';
        const [putRes2] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/magic/sterotypical`,
          headers: { 'Content-Length': content2.length, 'Content-Type': 'text/vnd.xyz' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(200);
        expect(putRes2.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes2.get('ETag')).not.to.equal(putRes1.get('ETag'));
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/magic/sterotypical` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content2);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content2.length);
        expect(getRes.get('Content-Type')).to.equal('text/vnd.xyz');
        expect(getRes.get('ETag')).to.equal(putRes2.get('ETag'));
      });

      it('allows an item to be overwritten with same value', async function () {
        const content = 'bees, wasps, ants & sawflies';
        const [putRes1] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/insects/hymenoptera`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/x.a' },
          body: content
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const [putRes2] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/insects/hymenoptera`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/x.a' },
          body: content
        });
        expect(putRes2.statusCode).to.equal(200);
        expect(putRes2.get('ETag')).to.equal(putRes1.get('ETag'));
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/insects/hymenoptera` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('text/x.a');
        expect(getRes.get('ETag')).to.equal(putRes1.get('ETag'));
      });

      it('truncates very long paths', async function () {
        const content = 'such a small thing';
        const originalRsPath = longString(1100);
        const originalUrlPath = `/${this.username}/` + originalRsPath;
        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: originalUrlPath,
          headers: { 'Content-Length': content.length, 'Content-Type': 'image/poster' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [getRes1] = await this.doHandle({ method: 'GET', url: originalUrlPath });
        expect(getRes1.statusCode).to.equal(200);
        expect(getRes1._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes1.get('Content-Length'))).to.equal(content.length);
        expect(getRes1.get('Content-Type')).to.equal('image/poster');
        expect(getRes1.get('ETag')).to.equal(putRes.get('ETag'));

        const limit = 1023 - 'remoteStorageBlob/'.length;
        const [getRes2] = await this.doHandle({ method: 'GET', url: `/${this.username}/` + originalRsPath.slice(0, limit) });
        expect(getRes2.statusCode).to.equal(200);
        expect(getRes2._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes2.get('Content-Length'))).to.equal(content.length);
        expect(getRes2.get('Content-Type')).to.equal('image/poster');
        expect(getRes2.get('ETag')).to.equal(putRes.get('ETag'));
      });

      it.skip('transfers very large files', async function () {
        this.timeout(60 * 60_000);

        const LIMIT = 1_000_000_000;
        // const LIMIT = 5_000_000_000_000;   // 5 TiB

        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/bigfile`,
          headers: { 'Content-Length': LIMIT, 'Content-Type': 'text/plain' },
          body: new LongStream(LIMIT)
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [headRes] = await this.doHandle({ method: 'HEAD', url: `/${this.username}/bigfile` });
        expect(headRes.statusCode).to.equal(200);
        expect(parseInt(headRes.get('Content-Length'))).to.equal(LIMIT);
        expect(headRes.get('Content-Type')).to.equal('text/plain');
        expect(headRes.get('ETag')).to.equal(putRes.get('ETag'));
      });

      it('creates a document when simultaneous identical requests are made', async function () {
        this.timeout(240_000);
        const LIMIT = 10_000_000;

        const [[res1, next1], [res2, next2]] = await Promise.all([
          this.doHandle({
            method: 'PUT',
            url: `/${this.username}/simultaneous-put`,
            headers: { 'Content-Length': LIMIT, 'Content-Type': 'text/plain' },
            body: new LongStream(LIMIT)
          }),
          this.doHandle({
            method: 'PUT',
            url: `/${this.username}/simultaneous-put`,
            headers: { 'Content-Length': LIMIT, 'Content-Type': 'text/plain' },
            body: new LongStream(LIMIT)
          })
        ]);

        expect(res1.statusCode).to.equal(201);
        expect(res1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(res1._getBuffer().toString()).to.equal('');
        expect(next1).not.to.have.been.called;

        expect(res2.statusCode).to.equal(201);
        expect(res2.get('ETag')).to.equal(res1.get('ETag'));
        expect(res2._getBuffer().toString()).to.equal('');
        expect(next2).not.to.have.been.called;

        const [headRes] = await this.doHandle({ method: 'HEAD', url: `/${this.username}/simultaneous-put` });
        expect(headRes.statusCode).to.equal(200);
        expect(parseInt(headRes.get('Content-Length'))).to.equal(LIMIT);
        expect(headRes.get('Content-Type')).to.equal('text/plain');
        expect(headRes.get('ETag')).to.equal(res1.get('ETag'));
      });

      it('creates at least one of conflicting simultaneous creates', async function () {
        this.timeout(240_000);
        const LONG = 10_000_000;
        const SHORT = 10_000;

        const [[resLong, nextLong], [resShort, nextShort]] = await Promise.all([
          this.doHandle({
            method: 'PUT',
            url: `/${this.username}/conflicting-simultanous-put`,
            headers: { 'Content-Length': LONG, 'Content-Type': 'text/csv' },
            body: new LongStream(LONG)
          }),
          this.doHandle({
            method: 'PUT',
            url: `/${this.username}/conflicting-simultanous-put`,
            headers: { 'Content-Length': SHORT, 'Content-Type': 'text/tab-separated-values' },
            body: new LongStream(SHORT)
          })
        ]);

        expect(resLong.statusCode).to.be.oneOf([201, 409, 503]);
        // expect(resLong.get('ETag')).to.match(/^".{6,128}"$/);
        expect(resLong._getBuffer().toString()).to.equal('');
        expect(nextLong).not.to.have.been.called;

        expect(resShort.statusCode).to.be.oneOf([201, 409, 503]);
        // expect(resShort.get('ETag')).to.match(/^".{6,128}"$/);
        expect(resShort.get('ETag')).not.to.equal(resLong.get('ETag'));
        expect(resShort._getBuffer().toString()).to.equal('');
        expect(nextShort).not.to.have.been.called;

        // One or neither call receives a Conflict.
        expect(resLong.statusCode + resShort.statusCode).to.be.lessThanOrEqual(201 + 503);

        const [headRes] = await this.doHandle({ method: 'HEAD', url: `/${this.username}/conflicting-simultanous-put` });
        expect(headRes.statusCode).to.equal(200);
        expect(parseInt(headRes.get('Content-Length'))).to.be.oneOf([LONG, SHORT]);
        expect(headRes.get('Content-Type')).to.be.oneOf(['text/csv', 'text/tab-separated-values']);
        expect(headRes.get('ETag')).to.be.oneOf([resLong.get('ETag'), resShort.get('ETag')]);
      });
    });

    describe('for a nested document', function () {
      it('sets the value of a deep item & creates the ancestor directories', async function () {
        const content = 'mindless content';
        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/photos/foo/bar/qux`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/example' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/photos/foo/bar/qux` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('text/example');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));

        const [dirRes1] = await this.doHandle({ method: 'GET', url: `/${this.username}/photos/foo/bar/` });
        expect(dirRes1.statusCode).to.equal(200);
        expect(dirRes1.get('Content-Type')).to.equal('application/ld+json');
        expect(dirRes1.get('ETag')).to.match(/^".{6,128}"$/);
        const directory1 = JSON.parse(dirRes1._getBuffer().toString());
        expect(directory1.items.qux['Content-Length']).to.be.equal(content.length);
        expect(directory1.items.qux['Content-Type']).to.be.equal('text/example');
        expect(directory1.items.qux.ETag).to.be.equal(putRes.get('ETag'));
        expect(Date.now() - new Date(directory1.items.qux['Last-Modified'])).to.be.lessThan(5000);

        const [dirRes2] = await this.doHandle({ method: 'GET', url: `/${this.username}/photos/foo/` });
        expect(dirRes2.statusCode).to.equal(200);
        expect(dirRes2.get('Content-Type')).to.equal('application/ld+json');
        expect(dirRes2.get('ETag')).to.match(/^".{6,128}"$/);
        const directory2 = JSON.parse(dirRes2._getBuffer().toString());
        expect(directory2.items['bar/']['Content-Length']).to.be.undefined;
        expect(directory2.items['bar/']['Content-Type']).to.be.undefined;
        expect(directory2.items['bar/'].ETag).to.be.equal(dirRes1.get('ETag'));
        expect(directory2.items['bar/']['Last-Modified']).to.be.undefined;

        const [dirRes3] = await this.doHandle({ method: 'GET', url: `/${this.username}/photos/` });
        expect(dirRes3.statusCode).to.equal(200);
        expect(dirRes3.get('Content-Type')).to.equal('application/ld+json');
        expect(dirRes3.get('ETag')).to.match(/^".{6,128}"$/);
        const directory3 = JSON.parse(dirRes3._getBuffer().toString());
        expect(directory3.items['foo/']['Content-Length']).to.be.undefined;
        expect(directory3.items['foo/']['Content-Type']).to.be.undefined;
        expect(directory3.items['foo/'].ETag).to.be.equal(dirRes2.get('ETag'));
        expect(directory3.items['foo/']['Last-Modified']).to.be.undefined;

        const [dirRes4] = await this.doHandle({ method: 'GET', url: `/${this.username}/` });
        expect(dirRes4.statusCode).to.equal(200);
        expect(dirRes4.get('Content-Type')).to.equal('application/ld+json');
        expect(dirRes4.get('ETag')).to.match(/^".{6,128}"$/);
        const directory4 = JSON.parse(dirRes4._getBuffer().toString());
        expect(directory4.items['photos/']['Content-Length']).to.be.undefined;
        expect(directory4.items['photos/']['Content-Type']).to.be.undefined;
        expect(directory4.items['photos/'].ETag).to.be.equal(dirRes3.get('ETag'));
        expect(directory4.items['photos/']['Last-Modified']).to.be.undefined;
      });

      it('does not create folder where a document exists', async function () {
        const content = 'Londonderry';
        const [putRes1] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/photos/collection`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'application/zip' },
          body: content
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const [putRes2] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/photos/collection/dramatic/winter`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'image/jxl' },
          body: content
        });
        expect(putRes2.statusCode).to.equal(409); // Conflict
        expect(putRes2.get('ETag')).to.be.undefined;
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [dirRes1] = await this.doHandle({ method: 'GET', url: `/${this.username}/photos/collection/dramatic/` });
        expect(dirRes1.statusCode).to.equal(200);
        expect(dirRes1.get('Content-Type')).to.equal('application/ld+json');
        const directory = dirRes1._getJSONData();
        expect(directory['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(directory.items).to.deep.equal({});
        expect(dirRes1.get('ETag')).to.match(/^"[#-~!]{6,128}"$/);

        const [dirRes2] = await this.doHandle({ method: 'GET', url: `/${this.username}/photos/collection/` });
        expect(dirRes2.statusCode).to.equal(409);
        expect(putRes2.get('ETag')).to.be.undefined;
        expect(putRes2.get('Content-Type')).to.be.undefined;
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/photos/collection` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('application/zip');
        expect(getRes.get('ETag')).to.equal(putRes1.get('ETag'));
      });

      it('does not create a document where a folder exists', async function () {
        const content = 'Dublin';
        const [putRes1] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/photos/album/movie-posters/Make Way for Tomorrow`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'image/jp2' },
          body: content
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const [putRes2] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/photos/album`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'application/archive' },
          body: content
        });
        expect(putRes2.statusCode).to.equal(409); // Conflict
        expect(putRes2.get('ETag')).to.be.undefined;
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [getRes1] = await this.doHandle({ method: 'GET', url: `/${this.username}/photos/album` });
        expect(getRes1.statusCode).to.equal(409);
        expect(getRes1._getBuffer().toString()).to.equal('');
        expect(getRes1.get('ETag')).to.be.undefined;

        const [getRes2] = await this.doHandle({ method: 'GET', url: `/${this.username}/photos/album/movie-posters/Make Way for Tomorrow` });
        expect(getRes2.statusCode).to.equal(200);
        expect(getRes2._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes2.get('Content-Length'))).to.equal(content.length);
        expect(getRes2.get('Content-Type')).to.equal('image/jp2');
        expect(getRes2.get('ETag')).to.equal(putRes1.get('ETag'));
      });
    });

    describe('versioning', function () {
      it('does not create a file when If-Match has an ETag', async function () {
        const content = 'Norm ate lunch.';
        const [putRes, next] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/photos/zipwire3`,
          body: content,
          headers: { 'If-Match': '"lk356l"', 'Content-Type': 'image/poster', 'Content-Length': content.length }
        });
        expect(putRes.statusCode).to.equal(412); // Precondition Failed
        expect(putRes.get('ETag')).to.be.undefined;
        expect(putRes._getBuffer().toString()).to.equal('');
        expect(next).not.to.have.been.called;

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/photos/zipwire3` });
        expect(getRes.statusCode).to.equal(404);
        expect(getRes._getBuffer().toString()).to.equal('');
      });

      it('updates a file when If-Match has a matching ETag', async function () {
        const content1 = 'Nemo';
        const [putRes1] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/existing/if-match`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/vnd.abc' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'Bligh';
        const [putRes2] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/existing/if-match`,
          headers: { 'If-Match': putRes1.get('ETag'), 'Content-Length': content2.length, 'Content-Type': 'text/vnd.xyz' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(200);
        expect(putRes2.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes2.get('ETag')).not.to.equal(putRes1.get('ETag'));
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/existing/if-match` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content2);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content2.length);
        expect(getRes.get('Content-Type')).to.equal('text/vnd.xyz');
        expect(getRes.get('ETag')).to.equal(putRes2.get('ETag'));
      });

      it('does not update a file when If-Match has an old ETag', async function () {
        const content1 = 'Nemo';
        const [putRes1] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/put/if-match/not equal`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/vnd.abc' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'Bligh';
        const [putRes2] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/put/if-match/not equal`,
          headers: { 'If-Match': '"l5k3l5j6l"', 'Content-Length': content2.length, 'Content-Type': 'text/vnd.xyz' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(412);
        expect(putRes2.get('ETag')).to.be.undefined;
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/put/if-match/not equal` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content1);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content1.length);
        expect(getRes.get('Content-Type')).to.equal('text/vnd.abc');
        expect(getRes.get('ETag')).to.equal(putRes1.get('ETag'));
      });

      it('creates the document if If-None-Match * is given for a non-existent item', async function () {
        const content = 'crocodile';
        const [putRes, next] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/if-none-match/new-star`,
          body: content,
          headers: { 'If-None-Match': '*', 'Content-Type': 'image/poster', 'Content-Length': content.length }
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');
        expect(next).not.to.have.been.called;

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/if-none-match/new-star` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('image/poster');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));
      });

      it('does not update a file when If-None-Match is *', async function () {
        const content1 = 'Nemo';
        const [putRes1] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/existing/if-none-match/update-star`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/vnd.abc' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'Bligh';
        const [putRes2] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/existing/if-none-match/update-star`,
          headers: { 'If-None-Match': '*', 'Content-Length': content2.length, 'Content-Type': 'text/vnd.xyz' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(412);
        expect(putRes2.get('ETag')).to.be.undefined;
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/existing/if-none-match/update-star` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content1);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content1.length);
        expect(getRes.get('Content-Type')).to.equal('text/vnd.abc');
        expect(getRes.get('ETag')).to.equal(putRes1.get('ETag'));
      });

      it('creates when If-None-Match is ETag (backup)', async function () {
        const content = 'crocodile';
        const [putRes, next] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/if-none-match/new-ETag`,
          body: content,
          headers: { 'If-None-Match': '"lk6jl5jlk35j6"', 'Content-Type': 'image/poster', 'Content-Length': content.length }
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');
        expect(next).not.to.have.been.called;

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/if-none-match/new-ETag` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('image/poster');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));
      });

      it('does not update a file when If-None-Match has same ETag (backup)', async function () {
        const content1 = 'Nemo';
        const [putRes1] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/existing/if-none-match/ETag same`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/vnd.abc' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'Bligh';
        const [putRes2] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/existing/if-none-match/ETag same`,
          headers: { 'If-None-Match': putRes1.get('ETag'), 'Content-Length': content2.length, 'Content-Type': 'text/vnd.xyz' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(412);
        expect(putRes2.get('ETag')).to.be.undefined;
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/existing/if-none-match/ETag same` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content1);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content1.length);
        expect(getRes.get('Content-Type')).to.equal('text/vnd.abc');
        expect(getRes.get('ETag')).to.equal(putRes1.get('ETag'));
      });

      it('overwrites a file when If-None-Match has a different ETag (newer backup)', async function () {
        const content1 = 'Nemo';
        const [putRes1] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/put/if-none-match/ETag not equal`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/vnd.abc' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'Bligh';
        const [putRes2] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/put/if-none-match/ETag not equal`,
          headers: { 'If-None-Match': '"lj6l5j6kl"', 'Content-Length': content2.length, 'Content-Type': 'text/vnd.xyz' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(200);
        expect(putRes2.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes2.get('ETag')).not.to.equal(putRes1.get('ETag'));
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [getRes] = await this.doHandle({ method: 'GET', url: `/${this.username}/put/if-none-match/ETag not equal` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content2);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content2.length);
        expect(getRes.get('Content-Type')).to.equal('text/vnd.xyz');
        expect(getRes.get('ETag')).to.equal(putRes2.get('ETag'));
      });
    });
  });

  describe('DELETE', function () {
    this.timeout(30_000);

    describe('unversioned', function () {
      it('should return Not Found for nonexistent user', async function () {
        const [res, next] = await this.doHandle({
          method: 'DELETE',
          url: '/not-a-user/some-category/some-directory/some-thing'
        });

        expect(next).not.to.have.been.called;
        expect(res.statusCode).to.equal(404);
        expect(res._getBuffer().toString()).to.equal('');
        expect(Boolean(res.get('ETag'))).to.be.false;
      });

      it('should return Not Found for nonexistent path', async function () {
        const [res, next] = await this.doHandle({
          method: 'DELETE',
          url: `/${this.username}/non-existent-category/non-existent-directory/non-existent-thing`
        });

        expect(next).not.to.have.been.called;
        expect(res.statusCode).to.equal(404);
        expect(res._getBuffer().toString()).to.equal('');
        expect(Boolean(res.get('ETag'))).to.be.false;
      });

      it('should return Conflict when target is a directory', async function () {
        const content = 'pad thai';
        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/consumables/food/thai/noodles/pad-thai`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/vnd.q' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [res, next] = await this.doHandle({
          method: 'DELETE',
          url: `/${this.username}/consumables/food`
        });

        expect(next).not.to.have.been.called;
        expect(res.statusCode).to.equal(409);
        expect(res._getBuffer().toString()).to.equal('');
        expect(Boolean(res.get('ETag'))).to.be.false;
      });

      it('should remove a file, empty parent directories, and remove directory entries', async function () {
        const content1 = 'wombat';
        const [putRes1] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/animal/vertebrate/australia/marsupial/wombat`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/vnd.latex-z' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'Alpine Ibex';
        const [putRes2] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/animal/vertebrate/europe/Capra ibex`,
          headers: { 'Content-Length': content2.length, 'Content-Type': 'text/vnd.abc' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(201);
        expect(putRes2.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [res, next] = await this.doHandle({
          method: 'DELETE',
          url: `/${this.username}/animal/vertebrate/australia/marsupial/wombat`
        });

        expect(res.statusCode).to.equal(204); // No Content
        expect(res._getBuffer().toString()).to.equal('');
        expect(res.get('ETag')).to.equal(putRes1.get('ETag'));
        expect(next).not.to.have.been.called;

        const [getRes1] = await this.doHandle({ method: 'GET', url: `/${this.username}/animal/vertebrate/australia/marsupial/wombat` });
        expect(getRes1.statusCode).to.equal(404);
        expect(getRes1._getBuffer().toString()).to.equal('');

        const [getRes2] = await this.doHandle({ method: 'GET', url: `/${this.username}/animal/vertebrate/australia/marsupial/` });
        expect(getRes2.statusCode).to.equal(200);
        expect(getRes2.get('Content-Type')).to.equal('application/ld+json');
        const directory1 = getRes2._getJSONData();
        expect(directory1['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(directory1.items).to.deep.equal({});
        expect(getRes2.get('ETag')).to.match(/^"[#-~!]{6,128}"$/);

        const [getRes3] = await this.doHandle({ method: 'GET', url: `/${this.username}/animal/vertebrate/australia/` });
        expect(getRes3.statusCode).to.equal(200);
        expect(getRes3.get('Content-Type')).to.equal('application/ld+json');
        const directory2 = getRes3._getJSONData();
        expect(directory2['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(directory2.items).to.deep.equal({});
        expect(getRes3.get('ETag')).to.match(/^"[#-~!]{6,128}"$/);

        const [getRes4] = await this.doHandle({ method: 'GET', url: `/${this.username}/animal/vertebrate/` });
        expect(getRes4.statusCode).to.equal(200);
        expect(getRes4.get('Content-Type')).to.equal('application/ld+json');
        expect(getRes4.get('ETag')).to.match(/^".{6,128}"$/);
        const directory = JSON.parse(getRes4._getBuffer().toString());
        expect(directory['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(directory.items['europe/'].ETag).to.match(/^".{6,128}"$/);

        const [res2, next2] = await this.doHandle({
          method: 'DELETE',
          url: `/${this.username}/animal/vertebrate/australia/marsupial/wombat`
        });
        expect(res2.statusCode).to.equal(404); // Not Found
        expect(res2._getBuffer().toString()).to.equal('');
        expect(res2.get('ETag')).to.equal(undefined);
        expect(next2).not.to.have.been.called;

        const [res3, next3] = await this.doHandle({
          method: 'DELETE',
          url: `/${this.username}/animal/vertebrate/australia/`
        });
        expect(res3.statusCode).to.equal(404); // Not Found, instead of Conflict
        expect(res3._getBuffer().toString()).to.equal('');
        expect(res3.get('ETag')).to.equal(undefined);
        expect(next3).not.to.have.been.called;
      });

      // OpenIO (container) always fails this test.
      it('succeeds at simultaneous deleting', async function () {
        this.timeout(120_000);
        const LIMIT = 1_000_000;

        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/simultaneous-delete`,
          headers: { 'Content-Length': LIMIT, 'Content-Type': 'text/x-foo' },
          body: new LongStream(LIMIT)
        });
        expect(putRes.statusCode).to.equal(201);

        const [[delRes1, delNext1], [delRes2, delNext2]] = await Promise.all([
          this.doHandle({ method: 'DELETE', url: `/${this.username}/simultaneous-delete` }),
          this.doHandle({ method: 'DELETE', url: `/${this.username}/simultaneous-delete` })
        ]);
        expect(delRes1.statusCode).to.be.oneOf([204, 404]);
        expect(delRes1.get('ETag')).to.equal(delRes1.statusCode === 204 ? putRes.get('ETag') : undefined);
        expect(delRes1._getBuffer().toString()).to.equal('');
        expect(delNext1).not.to.have.been.called;

        expect(delRes2.statusCode).to.be.oneOf([204, 404]);
        expect(delRes2.get('ETag')).to.equal(delRes2.statusCode === 204 ? putRes.get('ETag') : undefined);
        expect(delRes2._getBuffer().toString()).to.equal('');
        expect(delNext2).not.to.have.been.called;

        const [headRes] = await this.doHandle({ method: 'HEAD', url: `/${this.username}/simultaneous-delete` });
        expect(headRes.statusCode).to.equal(404);
        expect(headRes.get('ETag')).to.be.undefined;
      });
    });

    describe('versioned', function () {
      it('deletes a document if the If-Match header is equal', async function () {
        const content = 'elbow';
        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/deleting/if-match/equal`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/vnd.r' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [res, next] = await this.doHandle({
          method: 'DELETE',
          url: `/${this.username}/deleting/if-match/equal`,
          headers: { 'If-Match': putRes.get('ETag') }
        });

        expect(res.statusCode).to.equal(204);
        expect(res._getBuffer().toString()).to.equal('');
        expect(res.get('ETag')).to.equal(putRes.get('ETag'));
        expect(next).not.to.have.been.called;
      });

      it('should not delete a blob if the If-Match header isn\'t equal', async function () {
        const content = 'elbow';
        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/deleting/if-match/not-equal`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/vnd.r' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [res, next] = await this.doHandle({
          method: 'DELETE',
          url: `/${this.username}/deleting/if-match/not-equal`,
          headers: { 'If-Match': '"6a6a6a6a6a6a6"' }
        });

        expect(res.statusCode).to.equal(412);
        expect(res._getBuffer().toString()).to.equal('');
        expect(Boolean(res.get('ETag'))).to.be.false;
        expect(next).not.to.have.been.called;
      });

      it('should not delete a blob if the If-None-Match header is equal', async function () {
        const content = 'elbow';
        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/deleting/if-none-match/equal`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/vnd.r' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [res, next] = await this.doHandle({
          method: 'DELETE',
          url: `/${this.username}/deleting/if-none-match/equal`,
          headers: { 'If-None-Match': putRes.get('ETag') }
        });

        expect(res.statusCode).to.equal(412);
        expect(res._getBuffer().toString()).to.equal('');
        expect(Boolean(res.get('ETag'))).to.be.false;
        expect(next).not.to.have.been.called;
      });

      it('deletes a blob if the If-None-Match header is not equal', async function () {
        const content = 'elbow';
        const [putRes] = await this.doHandle({
          method: 'PUT',
          url: `/${this.username}/deleting/if-none-match/not-equal`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/vnd.r' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [res, next] = await this.doHandle({
          method: 'DELETE',
          url: `/${this.username}/deleting/if-none-match/not-equal`,
          headers: { 'If-None-Match': '"4l54jl5hio452"' }
        });

        expect(res.statusCode).to.equal(204);
        expect(res._getBuffer().toString()).to.equal('');
        expect(res.get('ETag')).to.equal(putRes.get('ETag'));
        expect(next).not.to.have.been.called;
      });
    });
  });
};
