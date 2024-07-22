/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */
/* eslint no-unused-vars: ["warn", { "varsIgnorePattern": "^_", "argsIgnorePattern": "^_" }]  */

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-spies'));
chai.use(require('chai-as-promised'));
const httpMocks = require('node-mocks-http');
const { open } = require('node:fs/promises');
const path = require('path');
const longString = require('./util/longString');
const LongStream = require('./util/LongStream');
const callMiddleware = require('./util/callMiddleware');
const YAML = require('yaml');
const NoSuchBlobError = require('../lib/util/NoSuchBlobError');

const ADMIN_INVITE_DIR_NAME = 'invites';
const LIST_DIR_NAME = 'stuff-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);

module.exports.shouldStoreStreams = function () {
  before(async function () {
    this.timeout(15_000);

    const usernameStore = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    const user = await this.store.createUser({ username: usernameStore, contactURL: 'l@m.no' }, new Set());
    this.userIdStore = user.username;
  });

  after(async function () {
    this.timeout(360_000);
    await this.store.deleteUser(this.userIdStore, new Set());
  });

  describe('upsertAdminBlob & readAdminBlob', function () {
    this.timeout(30_000);

    it('should store and retrieve blobs', async function () {
      const relativePath = path.join(ADMIN_INVITE_DIR_NAME, 'mailto%3Atestname%40testhost.org.yaml');
      const value = { foo: 'bar', spam: [42, 69, 'hut', 'hut', 'hike!'] };
      const content = YAML.stringify(value);

      const putResp = await this.handler.upsertAdminBlob(relativePath, 'application/yaml', content);
      expect(putResp).to.equal(content.length);

      const getResp = await this.handler.readAdminBlob(relativePath);
      expect(YAML.parse(getResp)).to.deep.equal(value);
    });
  });

  describe('metadataAdminBlob', function () {
    this.timeout(30_000);

    it('should retrieve metadata', async function () {
      const relativePath = path.join(ADMIN_INVITE_DIR_NAME, 'mailto%3Asomename%40somehost.edu.yaml');
      const content = YAML.stringify({ frotz: 'frell' });

      const putResp = await this.handler.upsertAdminBlob(relativePath, 'application/yaml', content);
      expect(putResp).to.equal(content.length);

      const headResp = await this.handler.metadataAdminBlob(relativePath);
      expect(headResp).to.have.property('contentType', 'application/yaml');
      expect(headResp).to.have.property('contentLength', content.length);
    });

    it('should throw NoSuchBlobError if no blob at path', async function () {
      await expect(this.handler.metadataAdminBlob('foo/bar/spam')).to.be.rejectedWith(NoSuchBlobError);
    });
  });

  describe('deleteAdminBlob', function () {
    this.timeout(30_000);

    it('should delete blob', async function () {
      const relativePath = path.join(ADMIN_INVITE_DIR_NAME, 'mailto%3Asomename%40somehost.edu.yaml');
      const content = YAML.stringify({ frotz: 'frell' });

      const putResp = await this.handler.upsertAdminBlob(relativePath, 'application/yaml', content);
      expect(putResp).to.equal(content.length);

      await this.handler.deleteAdminBlob(relativePath);

      await expect(this.handler.metadataAdminBlob(relativePath)).to.be.rejectedWith(Error);

      await this.handler.deleteAdminBlob(relativePath);
    });

    it('should succeed if no blob at path', async function () {
      await expect(this.handler.deleteAdminBlob('foo/bar/spam')).to.eventually.be.fulfilled;
    });
  });

  describe('listAdminBlobs', function () {
    it('should list blobs', async function () {
      const blobs = await this.handler.listAdminBlobs(LIST_DIR_NAME);
      expect(blobs).to.have.length(0);

      const content = 'indifferent content';
      this.listBlobPath = path.join(LIST_DIR_NAME, 'some-file.yaml');
      await this.handler.upsertAdminBlob(this.listBlobPath, 'text/plain', content);

      const blobs2 = await this.handler.listAdminBlobs(LIST_DIR_NAME);
      expect(blobs2).to.have.length(1);
      expect(blobs2[0].path).to.equal('some-file.yaml');
      // contentType is optional
      expect(blobs2[0].contentLength).to.equal(content.length);
      expect(typeof blobs2[0].ETag).to.equal('string');
      expect(new Date(blobs2[0].lastModified)).to.be.lessThanOrEqual(new Date());

      await this.handler.deleteAdminBlob(this.listBlobPath);

      const blobs3 = await this.handler.listAdminBlobs(LIST_DIR_NAME);
      expect(blobs3).to.have.length(0);
    });

    after(async function () {
      await this.handler.deleteAdminBlob(this.listBlobPath);
    });
  });

  describe('GET', function () {
    this.timeout(30_000);

    describe('for files', function () {
      describe('unversioned', function () {
        it('returns Not Found for a non-existing path', async function () {
          this.timeout(360_000);
          const [_req, res, next] = await callMiddleware(this.handler, {
            method: 'GET',
            url: `/${this.userIdStore}/non-existing/non-existing`
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
          const [_putReq, putRes] = await callMiddleware(this.handler, {
            method: 'PUT',
            url: `/${this.userIdStore}/existing/document`,
            headers: { 'Content-Length': content.length, 'Content-Type': 'text/cache-manifest' },
            body: content
          });
          expect(putRes.statusCode).to.equal(201);
          expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
          expect(putRes._getBuffer().toString()).to.equal('');

          const [_req, res, next] = await callMiddleware(this.handler, {
            method: 'GET',
            url: `/${this.userIdStore}/existing/not-existing`
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
          const [_putReq, putRes] = await callMiddleware(this.handler, {
            method: 'PUT',
            url: `/${this.userIdStore}/existing/file`,
            headers: { 'Content-Length': content.length, 'Content-Type': 'text/calendar' },
            body: content
          });
          expect(putRes.statusCode).to.equal(201);
          expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
          expect(putRes._getBuffer().toString()).to.equal('');

          const [_req, res, next] = await callMiddleware(this.handler, {
            method: 'GET',
            url: `/${this.userIdStore}/existing/file`,
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
          const [_putReq, putRes] = await callMiddleware(this.handler, {
            method: 'PUT',
            url: `/${this.userIdStore}/existing/thing`,
            headers: { 'Content-Length': content.length, 'Content-Type': 'text/plain' },
            body: content
          });
          expect(putRes.statusCode).to.equal(201);
          expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
          expect(putRes._getBuffer().toString()).to.equal('');

          const [_req, res, next] = await callMiddleware(this.handler, {
            method: 'GET',
            url: `/${this.userIdStore}/existing/thing`,
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
          const [_putReq, putRes] = await callMiddleware(this.handler, {
            method: 'PUT',
            url: `/${this.userIdStore}/existing/novel`,
            headers: { 'Content-Length': content.length, 'Content-Type': 'text/calendar' },
            body: content
          });
          expect(putRes.statusCode).to.equal(201);
          expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
          expect(putRes._getBuffer().toString()).to.equal('');

          const [_req, res, next] = await callMiddleware(this.handler, {
            method: 'GET',
            url: `/${this.userIdStore}/existing/novel`,
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
          const [_putReq, putRes] = await callMiddleware(this.handler, {
            method: 'PUT',
            url: `/${this.userIdStore}/existing/short-story`,
            headers: { 'Content-Length': content.length, 'Content-Type': 'text/plain' },
            body: content
          });
          expect(putRes.statusCode).to.equal(201);
          expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
          expect(putRes._getBuffer().toString()).to.equal('');

          const [_req, res, next] = await callMiddleware(this.handler, {
            method: 'GET',
            url: `/${this.userIdStore}/existing/short-story`,
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

    describe('for folders', function () {
      it('returns listing with no items for a non-existing category', async function () {
        const [_req, res, next] = await callMiddleware(this.handler, {
          method: 'GET',
          url: `/${this.userIdStore}/non-existing-category/`
        });

        expect(res.statusCode).to.equal(200);
        expect(res.get('Content-Type')).to.equal('application/ld+json');
        const folder = res._getJSONData();
        expect(folder['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(folder.items).to.deep.equal({});
        expect(res.get('ETag')).to.match(/^"[#-~!]{6,128}"$/);
        expect(next).not.to.have.been.called;
      });

      it('returns listing with no items for a non-existing folder in non-existing category', async function () {
        const [_req, res, next] = await callMiddleware(this.handler, {
          method: 'GET',
          url: `/${this.userIdStore}/non-existing-category/non-existing-folder/`
        });

        expect(res.statusCode).to.equal(200);
        expect(res.get('Content-Type')).to.equal('application/ld+json');
        const folder = res._getJSONData();
        expect(folder['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(folder.items).to.deep.equal({});
        expect(res.get('ETag')).to.match(/^"[#-~!]{6,128}"$/);
        expect(next).not.to.have.been.called;
      });

      it('returns JSON-LD unconditionally & Not Modified when If-None-Match has a matching ETag', async function () {
        const content1 = 'yellow, red';
        const [_putReq1, putRes1] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/color-category/color-folder/yellow-red`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/csv' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'blue & green';
        const [_putReq2, putRes2] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/color-category/color-folder/blue-green`,
          headers: { 'Content-Length': content2.length, 'Content-Type': 'text/n3' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(201);
        expect(putRes2.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes2._getBuffer().toString()).to.equal('');

        const content3 = 'purple -> ultraviolet';
        const [_putReq3, putRes3] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/color-category/color-folder/subfolder/purple-ultraviolet`,
          headers: { 'Content-Length': content3.length, 'Content-Type': 'text/plain' },
          body: content3
        });
        expect(putRes3.statusCode).to.equal(201);
        expect(putRes3.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes3._getBuffer().toString()).to.equal('');

        const [_getReq1, getRes1] = await callMiddleware(this.handler, {
          method: 'GET',
          url: `/${this.userIdStore}/color-category/color-folder/`
        });
        expect(getRes1.statusCode).to.equal(200);
        expect(getRes1.get('Content-Type')).to.equal('application/ld+json');
        expect(getRes1.get('ETag')).to.match(/^".{6,128}"$/);
        const folder = JSON.parse(getRes1._getBuffer().toString());
        expect(folder['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(folder.items['yellow-red'].ETag).to.equal(putRes1.get('ETag'));
        expect(folder.items['yellow-red']['Content-Type']).to.equal('text/csv');
        expect(folder.items['yellow-red']['Content-Length']).to.equal(content1.length);
        expect(Date.now() - new Date(folder.items['yellow-red']['Last-Modified'])).to.be.lessThan(9_000);
        expect(folder.items['blue-green'].ETag).to.equal(putRes2.get('ETag'));
        expect(folder.items['blue-green']['Content-Type']).to.equal('text/n3');
        expect(folder.items['blue-green']['Content-Length']).to.equal(content2.length);
        expect(Date.now() - new Date(folder.items['blue-green']['Last-Modified'])).to.be.lessThan(9_000);
        expect(folder.items['subfolder/'].ETag).to.match(/^".{6,128}"$/);

        const [_getReq2, getRes2] = await callMiddleware(this.handler, {
          method: 'GET',
          url: `/${this.userIdStore}/color-category/color-folder/`,
          headers: { 'If-None-Match': getRes1.get('ETag') }
        });
        expect(getRes2.statusCode).to.equal(304);
        expect(getRes2._getBuffer().toString()).to.equal('');
      });

      it('returns folder when If-None-Match has an old ETag', async function () {
        const content = 'mud';
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/fill-category/fill-folder/mud`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/vnd.qq' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, {
          method: 'GET',
          url: `/${this.userIdStore}/fill-category/fill-folder/`,
          headers: { 'If-None-Match': '"l6l56jl5j6lkl63jkl6jk"' }
        });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes.get('Content-Type')).to.equal('application/ld+json');
        expect(getRes.get('ETag')).to.match(/^".{6,128}"$/);
        const folder = JSON.parse(getRes._getBuffer().toString());
        expect(folder['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(folder.items.mud.ETag).to.equal(putRes.get('ETag'));
        expect(folder.items.mud['Content-Type']).to.equal('text/vnd.qq');
        expect(folder.items.mud['Content-Length']).to.equal(content.length);
        expect(Date.now() - new Date(folder.items.mud['Last-Modified'])).to.be.lessThan(9_000);
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
        const req = httpMocks.createRequest({ method: 'PUT', url: `/${this.userIdStore}//`, body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        const next = chai.spy();

        await this.handler(req, res, next);

        expect(next).to.have.been.called;
      });

      it('responds with Conflict for folder', async function () {
        const content = 'thing';
        const [_req, res, next] = await callMiddleware(this.handler, { method: 'PUT', url: `/${this.userIdStore}/not-created/`, body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });

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
        const req = httpMocks.createRequest({ method: 'PUT', url: `/${this.userIdStore}/`, body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        const next = chai.spy();

        await this.handler(req, res, next);

        expect(next).to.have.been.called;
      });

      it('does not create a file for a path with a bad character', async function () {
        const content = 'microbe';
        const req = httpMocks.createRequest({ method: 'PUT', url: `/${this.userIdStore}/foo\0bar`, body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        const next = chai.spy();

        await this.handler(req, res, next);

        expect(next).to.have.been.called;
      });

      it('does not create a file for a path with a bad element', async function () {
        const content = 'microbe';
        const req = httpMocks.createRequest({ method: 'PUT', url: `/${this.userIdStore}/foo/../bar`, body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        const next = chai.spy();

        await this.handler(req, res, next);

        expect(next).to.have.been.called;
      });

      it('sets the value of an item', async function () {
        const content = 'vertibo';
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/photos/zipwire`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'image/poster' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/photos/zipwire` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('image/poster');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));
      });

      it('sets the value of an item, without length', async function () {
        const content = 'vertibo';
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/photos/summer`,
          headers: { 'Content-Type': 'image/poster' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/photos/summer` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('image/poster');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));
      });

      it('set the type to application/binary if no type passed', async function () {
        const content = 'um num num';
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/no-type/doc`,
          headers: { 'Content-Length': content.length },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/no-type/doc` });
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
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/photos/election`,
          headers: { 'Content-Length': stat.size, 'Content-Type': 'image/jpeg' },
          body: fileStream
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');
        await fileHandle.close();

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/photos/election` });
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
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/public/photos/zipwire2`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'image/poster' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/public/photos/zipwire2` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('image/poster');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));

        const [_getReq2, getRes2] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/photos/zipwire2` });
        expect(getRes2.statusCode).to.equal(404);
        expect(getRes2._getBuffer().toString()).to.equal('');
      });

      it('sets the value of a root item', async function () {
        const content = 'gizmos';
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/manifesto`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/plain' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/manifesto` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('text/plain');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));
      });

      it('updates the value of an item', async function () {
        const content1 = 'abracadabra';
        const [_putReq1, putRes1] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/magic/sterotypical`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/vnd.abc' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'alakazam';
        const [_putReq2, putRes2] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/magic/sterotypical`,
          headers: { 'Content-Length': content2.length, 'Content-Type': 'text/vnd.xyz' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(200);
        expect(putRes2.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes2.get('ETag')).not.to.equal(putRes1.get('ETag'));
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/magic/sterotypical` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content2);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content2.length);
        expect(getRes.get('Content-Type')).to.equal('text/vnd.xyz');
        expect(getRes.get('ETag')).to.equal(putRes2.get('ETag'));
      });

      it('allows an item to be overwritten with same value', async function () {
        const content = 'bees, wasps, ants & sawflies';
        const [_putReq1, putRes1] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/insects/hymenoptera`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/x.a' },
          body: content
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const [_putReq2, putRes2] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/insects/hymenoptera`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/x.a' },
          body: content
        });
        expect(putRes2.statusCode).to.equal(200);
        expect(putRes2.get('ETag')).to.equal(putRes1.get('ETag'));
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/insects/hymenoptera` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('text/x.a');
        expect(getRes.get('ETag')).to.equal(putRes1.get('ETag'));
      });

      it('truncates very long paths', async function () {
        const content = 'such a small thing';
        const originalRsPath = longString(1100);
        const originalUrlPath = `/${this.userIdStore}/` + originalRsPath;
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: originalUrlPath,
          headers: { 'Content-Length': content.length, 'Content-Type': 'image/poster' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [_getReq1, getRes1] = await callMiddleware(this.handler, { method: 'GET', url: originalUrlPath });
        expect(getRes1.statusCode).to.equal(200);
        expect(getRes1._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes1.get('Content-Length'))).to.equal(content.length);
        expect(getRes1.get('Content-Type')).to.equal('image/poster');
        expect(getRes1.get('ETag')).to.equal(putRes.get('ETag'));

        const limit = 1023 - 'remoteStorageBlob/'.length;
        const [_getReq2, getRes2] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/` + originalRsPath.slice(0, limit) });
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

        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/bigfile`,
          headers: { 'Content-Length': LIMIT, 'Content-Type': 'text/plain' },
          body: new LongStream(LIMIT)
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [_headReq, headRes] = await callMiddleware(this.handler, { method: 'HEAD', url: `/${this.userIdStore}/bigfile` });
        expect(headRes.statusCode).to.equal(200);
        expect(parseInt(headRes.get('Content-Length'))).to.equal(LIMIT);
        expect(headRes.get('Content-Type')).to.equal('text/plain');
        expect(headRes.get('ETag')).to.equal(putRes.get('ETag'));
      });

      it('creates a document when simultaneous identical requests are made', async function () {
        this.timeout(240_000);
        const LIMIT = 10_000_000;

        const [[_req1, res1, next1], [_req2, res2, next2]] = await Promise.all([
          callMiddleware(this.handler, {
            method: 'PUT',
            url: `/${this.userIdStore}/simultaneous-put`,
            headers: { 'Content-Length': LIMIT, 'Content-Type': 'text/plain' },
            body: new LongStream(LIMIT)
          }),
          callMiddleware(this.handler, {
            method: 'PUT',
            url: `/${this.userIdStore}/simultaneous-put`,
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

        const [_headReq, headRes] = await callMiddleware(this.handler, { method: 'HEAD', url: `/${this.userIdStore}/simultaneous-put` });
        expect(headRes.statusCode).to.equal(200);
        expect(parseInt(headRes.get('Content-Length'))).to.equal(LIMIT);
        expect(headRes.get('Content-Type')).to.equal('text/plain');
        expect(headRes.get('ETag')).to.equal(res1.get('ETag'));
      });

      it('creates at least one of conflicting simultaneous creates', async function () {
        this.timeout(240_000);
        const LONG = 10_000_000;
        const SHORT = 10_000;

        const [[_, resLong, nextLong], [_reqShort, resShort, nextShort]] = await Promise.all([
          callMiddleware(this.handler, {
            method: 'PUT',
            url: `/${this.userIdStore}/conflicting-simultanous-put`,
            headers: { 'Content-Length': LONG, 'Content-Type': 'text/csv' },
            body: new LongStream(LONG)
          }),
          callMiddleware(this.handler, {
            method: 'PUT',
            url: `/${this.userIdStore}/conflicting-simultanous-put`,
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

        const [_headReq, headRes] = await callMiddleware(this.handler, { method: 'HEAD', url: `/${this.userIdStore}/conflicting-simultanous-put` });
        expect(headRes.statusCode).to.equal(200);
        expect(parseInt(headRes.get('Content-Length'))).to.be.oneOf([LONG, SHORT]);
        expect(headRes.get('Content-Type')).to.be.oneOf(['text/csv', 'text/tab-separated-values']);
        expect(headRes.get('ETag')).to.be.oneOf([resLong.get('ETag'), resShort.get('ETag')]);
      });
    });

    describe('for a nested document', function () {
      it('sets the value of a deep item & creates the ancestor folders', async function () {
        const content = 'mindless content';
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/photos/foo/bar/qux`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/example' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/photos/foo/bar/qux` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('text/example');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));

        const [_folderReq1, folderRes1] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/photos/foo/bar/` });
        expect(folderRes1.statusCode).to.equal(200);
        expect(folderRes1.get('Content-Type')).to.equal('application/ld+json');
        expect(folderRes1.get('ETag')).to.match(/^".{6,128}"$/);
        const folder1 = JSON.parse(folderRes1._getBuffer().toString());
        expect(folder1.items.qux['Content-Length']).to.be.equal(content.length);
        expect(folder1.items.qux['Content-Type']).to.be.equal('text/example');
        expect(folder1.items.qux.ETag).to.be.equal(putRes.get('ETag'));
        expect(Date.now() - new Date(folder1.items.qux['Last-Modified'])).to.be.lessThan(5000);

        const [_folderReq2, folderRes2] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/photos/foo/` });
        expect(folderRes2.statusCode).to.equal(200);
        expect(folderRes2.get('Content-Type')).to.equal('application/ld+json');
        expect(folderRes2.get('ETag')).to.match(/^".{6,128}"$/);
        const folder2 = JSON.parse(folderRes2._getBuffer().toString());
        expect(folder2.items['bar/']['Content-Length']).to.be.undefined;
        expect(folder2.items['bar/']['Content-Type']).to.be.undefined;
        expect(folder2.items['bar/'].ETag).to.be.equal(folderRes1.get('ETag'));
        expect(folder2.items['bar/']['Last-Modified']).to.be.undefined;

        const [_folderReq3, folderRes3] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/photos/` });
        expect(folderRes3.statusCode).to.equal(200);
        expect(folderRes3.get('Content-Type')).to.equal('application/ld+json');
        expect(folderRes3.get('ETag')).to.match(/^".{6,128}"$/);
        const folder3 = JSON.parse(folderRes3._getBuffer().toString());
        expect(folder3.items['foo/']['Content-Length']).to.be.undefined;
        expect(folder3.items['foo/']['Content-Type']).to.be.undefined;
        expect(folder3.items['foo/'].ETag).to.be.equal(folderRes2.get('ETag'));
        expect(folder3.items['foo/']['Last-Modified']).to.be.undefined;

        const [_folderReq4, folderRes4] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/` });
        expect(folderRes4.statusCode).to.equal(200);
        expect(folderRes4.get('Content-Type')).to.equal('application/ld+json');
        expect(folderRes4.get('ETag')).to.match(/^".{6,128}"$/);
        const folder4 = JSON.parse(folderRes4._getBuffer().toString());
        expect(folder4.items['photos/']['Content-Length']).to.be.undefined;
        expect(folder4.items['photos/']['Content-Type']).to.be.undefined;
        expect(folder4.items['photos/'].ETag).to.be.equal(folderRes3.get('ETag'));
        expect(folder4.items['photos/']['Last-Modified']).to.be.undefined;
      });

      it('does not create folder where a document exists', async function () {
        const content = 'Londonderry';
        const [_putReq1, putRes1] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/photos/collection`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'application/zip' },
          body: content
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getData()).to.equal('');

        const [_putReq2, putRes2] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/photos/collection/dramatic/winter`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'image/jxl' },
          body: content
        });
        expect(putRes2.statusCode).to.equal(409); // Conflict
        expect(putRes2.get('ETag')).to.be.undefined;
        expect(putRes2._getData()).to.match(/existing document/);

        const [_folderReq1, folderRes1] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/photos/collection/dramatic/` });
        expect(folderRes1.statusCode).to.equal(200); // folder with no items returns empty listing
        expect(folderRes1.get('Content-Type')).to.equal('application/ld+json');
        const folder = folderRes1._getJSONData();
        expect(folder['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(folder.items).to.deep.equal({});
        expect(folderRes1.get('ETag')).to.match(/^"[#-~!]{6,128}"$/);

        const [_folderReq2, folderRes2] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/photos/collection/` });
        expect(folderRes2.statusCode).to.equal(409);
        expect(folderRes2.get('ETag')).to.be.undefined;
        expect(folderRes2._getData()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/photos/collection` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('application/zip');
        expect(getRes.get('ETag')).to.equal(putRes1.get('ETag'));
      });

      it('does not create a document where a folder exists', async function () {
        const content = 'Dublin';
        const [_putReq1, putRes1] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/photos/album/movie-posters/Make Way for Tomorrow`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'image/jp2' },
          body: content
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const [_putReq2, putRes2] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/photos/album`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'application/archive' },
          body: content
        });
        expect(putRes2.statusCode).to.equal(409); // Conflict
        expect(putRes2.get('ETag')).to.be.undefined;
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [_getReq1, getRes1] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/photos/album` });
        expect(getRes1.statusCode).to.equal(409);
        expect(getRes1._getBuffer().toString()).to.equal('');
        expect(getRes1.get('ETag')).to.be.undefined;

        const [_getReq2, getRes2] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/photos/album/movie-posters/Make Way for Tomorrow` });
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
        const [_putReq, putRes, next] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/photos/zipwire3`,
          body: content,
          headers: { 'If-Match': '"lk356l"', 'Content-Type': 'image/poster', 'Content-Length': content.length }
        });
        expect(putRes.statusCode).to.equal(412); // Precondition Failed
        expect(putRes.get('ETag')).to.be.undefined;
        expect(putRes._getBuffer().toString()).to.equal('');
        expect(next).not.to.have.been.called;

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/photos/zipwire3` });
        expect(getRes.statusCode).to.equal(404);
        expect(getRes._getBuffer().toString()).to.equal('');
      });

      it('updates a file when If-Match has a matching ETag', async function () {
        const content1 = 'Nemo';
        const [_putReq1, putRes1] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/existing/if-match`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/vnd.abc' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'Bligh';
        const [_putReq2, putRes2] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/existing/if-match`,
          headers: { 'If-Match': putRes1.get('ETag'), 'Content-Length': content2.length, 'Content-Type': 'text/vnd.xyz' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(200);
        expect(putRes2.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes2.get('ETag')).not.to.equal(putRes1.get('ETag'));
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/existing/if-match` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content2);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content2.length);
        expect(getRes.get('Content-Type')).to.equal('text/vnd.xyz');
        expect(getRes.get('ETag')).to.equal(putRes2.get('ETag'));
      });

      it('does not update a file when If-Match has an old ETag', async function () {
        const content1 = 'Nemo';
        const [_putReq1, putRes1] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/put/if-match/not equal`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/vnd.abc' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'Bligh';
        const [_putReq2, putRes2] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/put/if-match/not equal`,
          headers: { 'If-Match': '"l5k3l5j6l"', 'Content-Length': content2.length, 'Content-Type': 'text/vnd.xyz' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(412);
        expect(putRes2.get('ETag')).to.be.undefined;
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/put/if-match/not equal` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content1);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content1.length);
        expect(getRes.get('Content-Type')).to.equal('text/vnd.abc');
        expect(getRes.get('ETag')).to.equal(putRes1.get('ETag'));
      });

      it('creates the document if If-None-Match * is given for a non-existent item', async function () {
        const content = 'crocodile';
        const [_putReq, putRes, next] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/if-none-match/new-star`,
          body: content,
          headers: { 'If-None-Match': '*', 'Content-Type': 'image/poster', 'Content-Length': content.length }
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');
        expect(next).not.to.have.been.called;

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/if-none-match/new-star` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('image/poster');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));
      });

      it('does not update a file when If-None-Match is *', async function () {
        const content1 = 'Nemo';
        const [_putReq1, putRes1] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/existing/if-none-match/update-star`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/vnd.abc' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'Bligh';
        const [_putReq2, putRes2] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/existing/if-none-match/update-star`,
          headers: { 'If-None-Match': '*', 'Content-Length': content2.length, 'Content-Type': 'text/vnd.xyz' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(412);
        expect(putRes2.get('ETag')).to.be.undefined;
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/existing/if-none-match/update-star` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content1);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content1.length);
        expect(getRes.get('Content-Type')).to.equal('text/vnd.abc');
        expect(getRes.get('ETag')).to.equal(putRes1.get('ETag'));
      });

      it('creates when If-None-Match is ETag (backup)', async function () {
        const content = 'crocodile';
        const [_putReq, putRes, next] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/if-none-match/new-ETag`,
          body: content,
          headers: { 'If-None-Match': '"lk6jl5jlk35j6"', 'Content-Type': 'image/poster', 'Content-Length': content.length }
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');
        expect(next).not.to.have.been.called;

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/if-none-match/new-ETag` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('image/poster');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));
      });

      it('does not update a file when If-None-Match has same ETag (backup)', async function () {
        const content1 = 'Nemo';
        const [_putReq1, putRes1] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/existing/if-none-match/ETag same`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/vnd.abc' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'Bligh';
        const [_putReq2, putRes2] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/existing/if-none-match/ETag same`,
          headers: { 'If-None-Match': putRes1.get('ETag'), 'Content-Length': content2.length, 'Content-Type': 'text/vnd.xyz' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(412);
        expect(putRes2.get('ETag')).to.be.undefined;
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/existing/if-none-match/ETag same` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content1);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content1.length);
        expect(getRes.get('Content-Type')).to.equal('text/vnd.abc');
        expect(getRes.get('ETag')).to.equal(putRes1.get('ETag'));
      });

      it('overwrites a file when If-None-Match has a different ETag (newer backup)', async function () {
        const content1 = 'Nemo';
        const [_putReq1, putRes1] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/put/if-none-match/ETag not equal`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/vnd.abc' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'Bligh';
        const [_putReq2, putRes2] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/put/if-none-match/ETag not equal`,
          headers: { 'If-None-Match': '"lj6l5j6kl"', 'Content-Length': content2.length, 'Content-Type': 'text/vnd.xyz' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(200);
        expect(putRes2.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes2.get('ETag')).not.to.equal(putRes1.get('ETag'));
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/put/if-none-match/ETag not equal` });
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
        const [_req, res, next] = await callMiddleware(this.handler, {
          method: 'DELETE',
          url: '/not-a-user/some-category/some-folder/some-thing'
        });

        expect(next).not.to.have.been.called;
        expect(res.statusCode).to.equal(404);
        expect(res._getBuffer().toString()).to.equal('');
        expect(Boolean(res.get('ETag'))).to.be.false;
      });

      it('should return Not Found for nonexistent path', async function () {
        const [_req, res, next] = await callMiddleware(this.handler, {
          method: 'DELETE',
          url: `/${this.userIdStore}/non-existent-category/non-existent-folder/non-existent-thing`
        });

        expect(next).not.to.have.been.called;
        expect(res.statusCode).to.equal(404);
        expect(res._getBuffer().toString()).to.equal('');
        expect(Boolean(res.get('ETag'))).to.be.false;
      });

      it('should return Conflict when target is a folder', async function () {
        const content = 'pad thai';
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/consumables/food/thai/noodles/pad-thai`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/vnd.q' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [_req, res, next] = await callMiddleware(this.handler, {
          method: 'DELETE',
          url: `/${this.userIdStore}/consumables/food`
        });

        expect(next).not.to.have.been.called;
        expect(res.statusCode).to.equal(409);
        expect(res._getBuffer().toString()).to.equal('');
        expect(Boolean(res.get('ETag'))).to.be.false;
      });

      it('should remove a file, empty parent folders, and remove folder entries', async function () {
        const content1 = 'wombat';
        const [_putReq1, putRes1] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/animal/vertebrate/australia/marsupial/wombat`,
          headers: { 'Content-Length': content1.length, 'Content-Type': 'text/vnd.latex-z' },
          body: content1
        });
        expect(putRes1.statusCode).to.equal(201);
        expect(putRes1.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes1._getBuffer().toString()).to.equal('');

        const content2 = 'Alpine Ibex';
        const [_putReq2, putRes2] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/animal/vertebrate/europe/Capra ibex`,
          headers: { 'Content-Length': content2.length, 'Content-Type': 'text/vnd.abc' },
          body: content2
        });
        expect(putRes2.statusCode).to.equal(201);
        expect(putRes2.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes2._getBuffer().toString()).to.equal('');

        const [_req, res, next] = await callMiddleware(this.handler, {
          method: 'DELETE',
          url: `/${this.userIdStore}/animal/vertebrate/australia/marsupial/wombat`
        });

        expect(res.statusCode).to.equal(204); // No Content
        expect(res._getBuffer().toString()).to.equal('');
        expect(res.get('ETag')).to.equal(putRes1.get('ETag'));
        expect(next).not.to.have.been.called;

        const [_getReq1, getRes1] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/animal/vertebrate/australia/marsupial/wombat` });
        expect(getRes1.statusCode).to.equal(404);
        expect(getRes1._getBuffer().toString()).to.equal('');

        const [_getReq2, getRes2] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/animal/vertebrate/australia/marsupial/` });
        expect(getRes2.statusCode).to.equal(200);
        expect(getRes2.get('Content-Type')).to.equal('application/ld+json');
        const folder2 = getRes2._getJSONData();
        expect(folder2['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(folder2.items).to.deep.equal({});
        expect(getRes2.get('ETag')).to.match(/^"[#-~!]{6,128}"$/);

        const [_getReq3, getRes3] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/animal/vertebrate/australia/` });
        expect(getRes3.statusCode).to.equal(200);
        expect(getRes3.get('Content-Type')).to.equal('application/ld+json');
        const folder3 = getRes3._getJSONData();
        expect(folder3['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(folder3.items).to.deep.equal({});
        expect(getRes3.get('ETag')).to.match(/^"[#-~!]{6,128}"$/);

        const [_getReq4, getRes4] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/animal/vertebrate/` });
        expect(getRes4.statusCode).to.equal(200);
        expect(getRes4.get('Content-Type')).to.equal('application/ld+json');
        expect(getRes4.get('ETag')).to.match(/^".{6,128}"$/);
        const folder4 = JSON.parse(getRes4._getBuffer().toString());
        expect(folder4['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(folder4.items['europe/'].ETag).to.match(/^".{6,128}"$/);

        const [_req2, res2, next2] = await callMiddleware(this.handler, {
          method: 'DELETE',
          url: `/${this.userIdStore}/animal/vertebrate/australia/marsupial/wombat`
        });
        expect(res2.statusCode).to.equal(404); // Not Found
        expect(res2._getBuffer().toString()).to.equal('');
        expect(res2.get('ETag')).to.equal(undefined);
        expect(next2).not.to.have.been.called;

        const [_req3, res3, next3] = await callMiddleware(this.handler, {
          method: 'DELETE',
          url: `/${this.userIdStore}/animal/vertebrate/australia/`
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

        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/simultaneous-delete`,
          headers: { 'Content-Length': LIMIT, 'Content-Type': 'text/x-foo' },
          body: new LongStream(LIMIT)
        });
        expect(putRes.statusCode).to.equal(201);

        const [[_delReq1, delRes1, delNext1], [_delReq2, delRes2, delNext2]] = await Promise.all([
          callMiddleware(this.handler, { method: 'DELETE', url: `/${this.userIdStore}/simultaneous-delete` }),
          callMiddleware(this.handler, { method: 'DELETE', url: `/${this.userIdStore}/simultaneous-delete` })
        ]);
        expect(delRes1.statusCode).to.be.oneOf([204, 404]);
        expect(delRes1.get('ETag')).to.equal(delRes1.statusCode === 204 ? putRes.get('ETag') : undefined);
        expect(delRes1._getBuffer().toString()).to.equal('');
        expect(delNext1).not.to.have.been.called;

        expect(delRes2.statusCode).to.be.oneOf([204, 404]);
        expect(delRes2.get('ETag')).to.equal(delRes2.statusCode === 204 ? putRes.get('ETag') : undefined);
        expect(delRes2._getBuffer().toString()).to.equal('');
        expect(delNext2).not.to.have.been.called;

        const [_headReq, headRes] = await callMiddleware(this.handler, { method: 'HEAD', url: `/${this.userIdStore}/simultaneous-delete` });
        expect(headRes.statusCode).to.equal(404);
        expect(headRes.get('ETag')).to.be.undefined;
      });
    });

    describe('versioned', function () {
      it('deletes a document if the If-Match header is equal', async function () {
        const content = 'elbow';
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/deleting/if-match/equal`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/vnd.r' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [_req, res, next] = await callMiddleware(this.handler, {
          method: 'DELETE',
          url: `/${this.userIdStore}/deleting/if-match/equal`,
          headers: { 'If-Match': putRes.get('ETag') }
        });

        expect(res.statusCode).to.equal(204);
        expect(res._getBuffer().toString()).to.equal('');
        expect(res.get('ETag')).to.equal(putRes.get('ETag'));
        expect(next).not.to.have.been.called;
      });

      it('should not delete a blob if the If-Match header isn\'t equal', async function () {
        const content = 'elbow';
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/deleting/if-match/not-equal`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/vnd.r' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [_req, res, next] = await callMiddleware(this.handler, {
          method: 'DELETE',
          url: `/${this.userIdStore}/deleting/if-match/not-equal`,
          headers: { 'If-Match': '"6a6a6a6a6a6a6"' }
        });

        expect(res.statusCode).to.equal(412);
        expect(res._getBuffer().toString()).to.equal('');
        expect(Boolean(res.get('ETag'))).to.be.false;
        expect(next).not.to.have.been.called;
      });

      it('should not delete a blob if the If-None-Match header is equal', async function () {
        const content = 'elbow';
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/deleting/if-none-match/equal`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/vnd.r' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [_req, res, next] = await callMiddleware(this.handler, {
          method: 'DELETE',
          url: `/${this.userIdStore}/deleting/if-none-match/equal`,
          headers: { 'If-None-Match': putRes.get('ETag') }
        });

        expect(res.statusCode).to.equal(412);
        expect(res._getBuffer().toString()).to.equal('');
        expect(Boolean(res.get('ETag'))).to.be.false;
        expect(next).not.to.have.been.called;
      });

      it('deletes a blob if the If-None-Match header is not equal', async function () {
        const content = 'elbow';
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/deleting/if-none-match/not-equal`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/vnd.r' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [_req, res, next] = await callMiddleware(this.handler, {
          method: 'DELETE',
          url: `/${this.userIdStore}/deleting/if-none-match/not-equal`,
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
