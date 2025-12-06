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
  this.timeout(60_000);

  before(async function () {
    const usernameStore = ('automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER)).slice(0, 29);
    const user = await this.store.createUser({ username: usernameStore, contactURL: 'l@m.no' }, new Set());
    this.userIdStore = user.username;
  });

  after(async function () {
    this.timeout(360_000);
    await this.store.deleteUser(this.userIdStore, new Set());
  });

  describe('upsertAdminBlob & readAdminBlob', function () {
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
    this.timeout(60_000);

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

      const startTime = new Date();
      const content = 'indifferent content';
      this.listBlobPath = path.join(LIST_DIR_NAME, 'some-file.yaml');
      await this.handler.upsertAdminBlob(this.listBlobPath, 'text/plain', content);

      const blobs2 = await this.handler.listAdminBlobs(LIST_DIR_NAME);
      expect(blobs2).to.have.length(1);
      expect(blobs2[0].path).to.equal('some-file.yaml');
      // contentType is optional
      expect(blobs2[0].contentLength).to.equal(content.length);
      expect(typeof blobs2[0].ETag).to.equal('string');
      // allows one second of clock skew between S3 server and this server
      expect(new Date(blobs2[0].lastModified)).to.be.lessThanOrEqual(new Date(Date.now() + 1000));
      expect(new Date(blobs2[0].lastModified)).to.be.greaterThanOrEqual(new Date(startTime - 1000));

      await this.handler.deleteAdminBlob(this.listBlobPath);

      const blobs3 = await this.handler.listAdminBlobs(LIST_DIR_NAME);
      expect(blobs3).to.have.length(0);
    });

    after(async function () {
      await this.handler.deleteAdminBlob(this.listBlobPath);
    });
  });

  describe('GET', function () {
    describe('for files', function () {
      describe('unversioned', function () {
        it('returns Not Found for a non-existing user', async function () {
          this.timeout(360_000);
          const [_req, res, next] = await callMiddleware(this.handler, {
            method: 'GET',
            url: '/not-the-user/public/who-knows'
          });

          expect(res.statusCode).to.equal(404);
          expect(res._getData()).to.equal('');
          expect(Boolean(res.get('Content-Length'))).to.be.false;
          expect(Boolean(res.get('Content-Type'))).to.be.false;
          expect(Boolean(res.get('ETag'))).to.be.false;
          expect(res._getData()).to.equal(''); // doesn't explain
          expect(next).not.to.have.been.called();
        });

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
          expect(res._getData()).to.equal(''); // doesn't explain
          expect(next).not.to.have.been.called();
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
          expect(res._getData()).to.equal(''); // doesn't explain
          expect(next).not.to.have.been.called();
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
          expect(next).not.to.have.been.called();
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
          expect(next).not.to.have.been.called();
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
          expect(next).not.to.have.been.called();
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
          expect(next).not.to.have.been.called();
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
        expect(next).not.to.have.been.called();

        const logNotes = new Set();
        const newFolder = await this.handler.listFolder(this.userIdStore, 'non-existing-category/', true, logNotes);
        expect(Object.keys(newFolder.items).length).to.equal(0);
        expect(logNotes.size).to.equal(0);
      });

      it('returns listing with no items for a non-existing public folder', async function () {
        const [_req, res, next] = await callMiddleware(this.handler, {
          method: 'GET',
          url: `/${this.userIdStore}/public/some-category/`
        });

        expect(res.statusCode).to.equal(200);
        expect(res.get('Content-Type')).to.equal('application/ld+json');
        const folder = res._getJSONData();
        expect(folder['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(folder.items).to.deep.equal({});
        expect(res.get('ETag')).to.match(/^"[#-~!]{6,128}"$/);
        expect(next).not.to.have.been.called();

        const logNotes = new Set();
        const newFolder = await this.handler.listFolder(this.userIdStore, 'public/some-category/', true, logNotes);
        expect(Object.keys(newFolder.items).length).to.equal(0);
        expect(logNotes.size).to.equal(0);
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
        expect(next).not.to.have.been.called();

        const logNotes = new Set();
        const newFolder = await this.handler.listFolder(this.userIdStore, 'non-existing-category/non-existing-folder/', true, logNotes);
        expect(Object.keys(newFolder.items).length).to.equal(0);
        expect(logNotes.size).to.equal(0);
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
        const folder = JSON.parse(getRes1._getData());
        expect(folder['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(folder.items['yellow-red'].ETag).to.equal(stripQuotes(putRes1.get('ETag')));
        expect(folder.items['yellow-red']['Content-Type']).to.equal('text/csv');
        expect(folder.items['yellow-red']['Content-Length']).to.equal(content1.length);
        expect(Date.now() - new Date(folder.items['yellow-red']['Last-Modified'])).to.be.lessThan(60_000);
        expect(folder.items['blue-green'].ETag).to.equal(stripQuotes(putRes2.get('ETag')));
        expect(folder.items['blue-green']['Content-Type']).to.equal('text/n3');
        expect(folder.items['blue-green']['Content-Length']).to.equal(content2.length);
        expect(Date.now() - new Date(folder.items['blue-green']['Last-Modified'])).to.be.lessThan(60_000);
        expect(folder.items['subfolder/'].ETag).to.match(/^.{6,128}$/);

        const [_subfolderReq, subfolderRes] = await callMiddleware(this.handler, {
          method: 'GET',
          url: `/${this.userIdStore}/color-category/color-folder/subfolder/`
        });
        expect(subfolderRes.statusCode).to.equal(200);
        expect(subfolderRes.get('Content-Type')).to.equal('application/ld+json');
        expect(subfolderRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(stripQuotes(subfolderRes.get('ETag'))).to.equal(folder.items['subfolder/'].ETag);
        const subfolder = JSON.parse(subfolderRes._getBuffer().toString());
        expect(subfolder['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(subfolder.items['purple-ultraviolet'].ETag).to.equal(stripQuotes(putRes3.get('ETag')));
        expect(subfolder.items['purple-ultraviolet']['Content-Type']).to.equal('text/plain');
        expect(subfolder.items['purple-ultraviolet']['Content-Length']).to.equal(content3.length);
        expect(Date.now() - new Date(subfolder.items['purple-ultraviolet']['Last-Modified'])).to.be.lessThan(15_000);

        const [_getReq2, getRes2] = await callMiddleware(this.handler, {
          method: 'GET',
          url: `/${this.userIdStore}/color-category/color-folder/`,
          headers: { 'If-None-Match': getRes1.get('ETag') }
        });
        expect(getRes2.statusCode).to.equal(304);
        expect(getRes2._getBuffer().toString()).to.equal('');

        const content3changed = 'plum & not visible';
        const [_putReq4, putRes4] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/color-category/color-folder/subfolder/purple-ultraviolet`,
          headers: { 'Content-Length': content3changed.length, 'Content-Type': 'text/plain' },
          body: content3changed
        });
        expect(putRes4.statusCode).to.equal(200);
        expect(putRes4.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes4.get('ETag')).not.to.equal(putRes3.get('ETag'));
        expect(putRes4._getBuffer().toString()).to.equal('');

        const [_folderReq2, folderRes2] = await callMiddleware(this.handler, {
          method: 'GET',
          url: `/${this.userIdStore}/color-category/color-folder/`,
          headers: { 'If-None-Match': getRes1.get('ETag') }
        });
        expect(folderRes2.statusCode).to.equal(200);
        expect(folderRes2.get('ETag')).to.match(/^".{6,128}"$/);
        expect(folderRes2.get('ETag')).not.to.equal(getRes1.get('ETag'));
        const folderChanged = JSON.parse(folderRes2._getData());
        expect(folderChanged.items['yellow-red'].ETag).to.equal(stripQuotes(putRes1.get('ETag')));
        expect(folderChanged.items['blue-green'].ETag).to.equal(stripQuotes(putRes2.get('ETag')));
        expect(folderChanged.items['subfolder/'].ETag).to.match(/^.{6,128}$/);
        expect(folderChanged.items['subfolder/'].ETag).not.to.equal(folder.items['subfolder/'].ETag);

        const [_subfolderReq2, subfolderRes2] = await callMiddleware(this.handler, {
          method: 'GET',
          url: `/${this.userIdStore}/color-category/color-folder/subfolder/`
        });
        expect(subfolderRes2.statusCode).to.equal(200);
        expect(subfolderRes2.get('ETag')).to.match(/^".{6,128}"$/);
        expect(stripQuotes(subfolderRes2.get('ETag'))).not.to.equal(folder.items['subfolder/'].ETag);
        expect(stripQuotes(subfolderRes2.get('ETag'))).to.equal(folderChanged.items['subfolder/'].ETag);
        const subfolderChanged = JSON.parse(subfolderRes2._getBuffer().toString());
        expect(subfolderChanged.items['purple-ultraviolet'].ETag).not.to.equal(stripQuotes(putRes3.get('ETag')));
        expect(subfolderChanged.items['purple-ultraviolet'].ETag).to.equal(stripQuotes(putRes4.get('ETag')));
        expect(Date.now() - new Date(subfolderChanged.items['purple-ultraviolet']['Last-Modified'])).to.be.lessThan(15_000);

        const logNotes = new Set();
        const newFolder = await this.handler.listFolder(this.userIdStore, 'color-category/color-folder/', true, logNotes);
        expect(newFolder.items).to.deep.equal(folderChanged.items);
        expect(logNotes.size).to.equal(1);

        const categoryFolder = await this.handler.listFolder(this.userIdStore, 'color-category/', true, logNotes);
        expect(categoryFolder.items['color-folder/'].ETag).to.match(/^.{6,128}$/);
        expect(Object.keys(categoryFolder.items)).to.have.lengthOf(1);

        const rootFolder = await this.handler.listFolder(this.userIdStore, '', true, logNotes);
        expect(rootFolder.items['color-category/'].ETag).to.match(/^.{6,128}$/);
        expect(Object.keys(rootFolder.items).length).to.be.lessThanOrEqual(2);
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
        const folder = JSON.parse(getRes._getData());
        expect(folder['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(folder.items.mud.ETag).to.equal(stripQuotes(putRes.get('ETag')));
        expect(folder.items.mud['Content-Type']).to.equal('text/vnd.qq');
        expect(folder.items.mud['Content-Length']).to.equal(content.length);
        expect(Date.now() - new Date(folder.items.mud['Last-Modified'])).to.be.lessThan(15_000);

        const logNotes = new Set();
        const newFolder = await this.handler.listFolder(this.userIdStore, 'fill-category/fill-folder', true, logNotes);
        expect(newFolder).to.deep.equal(folder);
        expect(logNotes.size).to.equal(1);
      });
    });
  });

  describe('PUT', function () {
    describe('unversioned', function () {
      it('does not create a file for a bad user name', async function () {
        const content = 'microbe';
        const req = httpMocks.createRequest({ method: 'PUT', url: '/@@@/not-created/non-existent/user', body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        res.logNotes = new Set();
        const next = chai.spy();

        await this.handler(req, res, next);

        // expect(res.statusCode).to.be.greaterThanOrEqual(400);
        // expect(res.get('Content-Type')).to.equal('text/plain');
        // expect(res._getData()).to.match(/msgId=/);
        expect(next).not.to.have.been.called();
      });

      it('does not create a file for a bad path', async function () {
        const content = 'microbe';
        const req = httpMocks.createRequest({ method: 'PUT', url: `/${this.userIdStore}//`, body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        res.logNotes = new Set();
        const next = chai.spy();

        await this.handler(req, res, next);

        expect(res.statusCode).to.equal(400);
        expect(res._getData()).to.equal('invalid path');
        expect(next).not.to.have.been.called();
      });

      it('responds with Conflict for folder', async function () {
        const content = 'thing';
        const [_req, res, next] = await callMiddleware(this.handler, { method: 'PUT', url: `/${this.userIdStore}/not-created/`, body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });

        expect(res.statusCode).to.equal(409);
        expect(res._getBuffer().toString()).to.equal('');
        expect(next).not.to.have.been.called();
      });

      // TODO: should there be a clearer message?
      // A nonexistent user here means storage has been deleted but the account still exists.
      it('does not create a file for a nonexistant user', async function () {
        const content = 'microbe';
        const req = httpMocks.createRequest({ method: 'PUT', url: '/non-existent-user/not-created/non-existent/user', body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        res.logNotes = new Set();
        const next = chai.spy();

        await this.handler(req, res, next);

        // expect(res.statusCode).to.be.greaterThanOrEqual(400);
        // expect(res._getData() ).to.equal('invalid path');
        expect(next).not.to.have.been.called();
      });

      it('does not create a file for an empty path', async function () {
        const content = 'microbe';
        const req = httpMocks.createRequest({ method: 'PUT', url: `/${this.userIdStore}/`, body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        res.logNotes = new Set();
        const next = chai.spy();

        await this.handler(req, res, next);

        // expect(res.statusCode).to.equal(400);
        // expect(res._getData() ).to.equal('invalid path');
        expect(next).not.to.have.been.called();
      });

      it('does not create a file for a path with a bad character', async function () {
        const content = 'microbe';
        const req = httpMocks.createRequest({ method: 'PUT', url: `/${this.userIdStore}/foo\0bar`, body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        res.logNotes = new Set();
        const next = chai.spy();

        await this.handler(req, res, next);

        expect(res.statusCode).to.equal(400);
        expect(res._getData()).to.equal('invalid path');
        expect(next).not.to.have.been.called();
      });

      it('does not create a file for a path with a bad element', async function () {
        const content = 'microbe';
        const req = httpMocks.createRequest({ method: 'PUT', url: `/${this.userIdStore}/foo/../bar`, body: content, headers: { 'Content-Type': 'image/tiff', 'Content-Length': content.length } });
        const res = httpMocks.createResponse({ req });
        res.logNotes = new Set();
        const next = chai.spy();

        await this.handler(req, res, next);

        expect(res.statusCode).to.equal(400);
        expect(res._getData()).to.equal('invalid path');
        expect(next).not.to.have.been.called();
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

      it('blocks creating document in root folder', async function () {
        const content = 'gizmos';
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/manifesto`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/plain' },
          body: content
        });
        expect(putRes.statusCode).to.equal(409);
        expect(putRes._getData()).to.match(/document in root folder/);
        expect(putRes.get('Content-Type')).to.equal('text/plain');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/manifesto` });
        expect(getRes.statusCode).to.equal(404);
        expect(getRes._getData()).to.equal('');
        expect(getRes.get('Content-Length')).to.be.undefined;
        expect(getRes.get('Content-Type')).to.be.undefined;
        expect(getRes.get('ETag')).to.be.undefined;
      });

      it('updates the value of an item & its folder entry', async function () {
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

        // getting the folder forces S3 store to cache folder & type
        const [_folderReq1, folderRes1] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/magic/` });
        expect(folderRes1.statusCode).to.equal(200);
        expect(folderRes1.get('Content-Type')).to.equal('application/ld+json');
        const folder1 = folderRes1._getJSONData();
        expect(folder1.items.sterotypical).to.have.property('ETag', stripQuotes(putRes1.get('ETag')));
        expect(folder1.items.sterotypical).to.have.property('Content-Type', 'text/vnd.abc');
        expect(folder1.items.sterotypical).to.have.property('Content-Length', content1.length);

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

        const [_folderReq2, folderRes2] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/magic/` });
        expect(folderRes2.statusCode).to.equal(200);
        expect(folderRes2.get('Content-Type')).to.equal('application/ld+json');
        const folder2 = folderRes2._getJSONData();
        expect(folder2.items.sterotypical).to.have.property('ETag', stripQuotes(putRes2.get('ETag')));
        expect(folder2.items.sterotypical).to.have.property('Content-Type', 'text/vnd.xyz');
        expect(folder2.items.sterotypical).to.have.property('Content-Length', content2.length);
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
            url: `/${this.userIdStore}/sim-category/simultaneous-put`,
            headers: { 'Content-Length': LIMIT, 'Content-Type': 'text/plain' },
            body: new LongStream(LIMIT)
          }),
          callMiddleware(this.handler, {
            method: 'PUT',
            url: `/${this.userIdStore}/sim-category/simultaneous-put`,
            headers: { 'Content-Length': LIMIT, 'Content-Type': 'text/plain' },
            body: new LongStream(LIMIT)
          })
        ]);

        expect(res1.statusCode).to.be.oneOf([201, 409]);
        expect(res1._getBuffer().toString()).to.equal('');
        expect(next1).not.to.have.been.called();

        expect(res2.statusCode).to.be.oneOf([201, 409]);
        expect(res2._getBuffer().toString()).to.equal('');
        expect(next2).not.to.have.been.called();

        expect(res1.get('ETag') || res2.get('ETag')).to.match(/^".{6,128}"$/);

        const [_headReq, headRes] = await callMiddleware(this.handler, { method: 'HEAD', url: `/${this.userIdStore}/sim-category/simultaneous-put` });
        expect(headRes.statusCode).to.equal(200);
        expect(parseInt(headRes.get('Content-Length'))).to.equal(LIMIT);
        expect(headRes.get('Content-Type')).to.equal('text/plain');
        expect(headRes.get('ETag')).to.equal(res1.get('ETag') || res2.get('ETag'));

        const logNotes = new Set();
        const folder = await this.handler.listFolder(this.userIdStore, '/sim-category/', true, logNotes);
        expect(folder.items['simultaneous-put'].ETag).to.equal(stripQuotes(res1.get('ETag') || res2.get('ETag')));
        expect(folder.items['simultaneous-put']['Content-Type']).to.equal('text/plain');
        expect(folder.items['simultaneous-put']['Content-Length']).to.equal(LIMIT);
        expect(Math.abs(Date.parse(folder.items['simultaneous-put']['Last-Modified']) - Date.now())).to.be.lessThan(10 * 60 * 1000);
        expect(logNotes.size).to.equal(1);
      });

      it('creates at least one of conflicting simultaneous creates', async function () {
        this.timeout(240_000);
        const LONG = 10_001;
        const SHORT = 10_000;

        const [[_, resLong, nextLong], [_reqShort, resShort, nextShort]] = await Promise.all([
          callMiddleware(this.handler, {
            method: 'PUT',
            url: `/${this.userIdStore}/clash/conflicting-simultanous-put`,
            headers: { 'Content-Length': LONG, 'Content-Type': 'text/csv' },
            body: new LongStream(LONG)
          }),
          callMiddleware(this.handler, {
            method: 'PUT',
            url: `/${this.userIdStore}/clash/conflicting-simultanous-put`,
            headers: { 'Content-Length': SHORT, 'Content-Type': 'text/tab-separated-values' },
            body: new LongStream(SHORT)
          })
        ]);

        expect(resLong.statusCode).to.be.oneOf([201, 409, 429, 503]);
        expect(resLong._getBuffer().toString()).to.equal('');
        expect(nextLong).not.to.have.been.called();

        expect(resShort.statusCode).to.be.oneOf([201, 409, 429, 503]);
        expect(resShort._getBuffer().toString()).to.equal('');
        expect(nextShort).not.to.have.been.called();

        expect(resLong.get('ETag') || resShort.get('ETag')).to.match(/^".{6,128}"$/);
        expect(resShort.get('ETag')).not.to.equal(resLong.get('ETag'));

        // At least one succeeds
        expect([resLong.statusCode, resShort.statusCode]).to.include(201);

        const [_headReq, headRes] = await callMiddleware(this.handler, { method: 'HEAD', url: `/${this.userIdStore}/clash/conflicting-simultanous-put` });
        expect(headRes.statusCode).to.equal(200);
        expect(parseInt(headRes.get('Content-Length'))).to.be.oneOf([LONG, SHORT]);
        expect(headRes.get('Content-Type')).to.be.oneOf(['text/csv', 'text/tab-separated-values']);
        expect(headRes.get('ETag')).to.be.oneOf([resLong.get('ETag'), resShort.get('ETag')]);

        const [_folderReq, folderRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/clash/` });
        expect(folderRes.statusCode).to.equal(200);
        expect(folderRes.get('Content-Type')).to.equal('application/ld+json');
        const folder = folderRes._getJSONData(); // short-hand for JSON.parse( response._getData() );
        expect(folder['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(folder.items['conflicting-simultanous-put'].ETag).to.match(/^"?[#-~!]{6,128}"?$/);
        expect(folder.items['conflicting-simultanous-put'].ETag).to.equal(stripQuotes(headRes.get('ETag')));
        expect(folder.items['conflicting-simultanous-put']['Content-Type']).to.equal(headRes.get('Content-Type'));
        expect(folder.items['conflicting-simultanous-put']['Content-Length']).to.equal(JSON.parse(headRes.get('Content-Length')));
        expect(Math.abs(Date.parse(folder.items['conflicting-simultanous-put']['Last-Modified']) - Date.now())).to.be.lessThan(10 * 60 * 1000);
        expect(folderRes.get('ETag')).to.match(/^"[#-~!]{6,128}"$/);

        const logNotes = new Set();
        const folderFromS3 = await this.handler.listFolder(this.userIdStore, '/clash/', true, logNotes);
        expect(folderFromS3.items['conflicting-simultanous-put'].ETag).to.be.oneOf([stripQuotes(resLong.get('ETag')), stripQuotes(resShort.get('ETag'))]);
        expect(folderFromS3.items['conflicting-simultanous-put']['Content-Type']).to.equal(headRes.get('Content-Type'));
        expect(folderFromS3.items['conflicting-simultanous-put']['Content-Length']).to.be.oneOf([LONG, SHORT]);
        expect(Math.abs(Date.parse(folderFromS3.items['conflicting-simultanous-put']['Last-Modified']) - Date.now())).to.be.lessThan(10 * 60 * 1000);
        expect(Object.keys(folderFromS3.items)).to.have.length(1);
        expect(logNotes.size).to.equal(1);
      });

      it('adds all to parent dir when simultaneous sibling requests are made', async function () {
        this.timeout(240_000);
        const LIMIT = 1_000;
        const COUNT = 6;

        const calls = [];
        for (let i = 0; i < COUNT; i++) {
          calls[i] = callMiddleware(this.handler, {
            method: 'PUT',
            url: `/${this.userIdStore}/category-all/folder-all/sibling-put-${i}`,
            headers: { 'Content-Length': LIMIT, 'Content-Type': `text/${i}` },
            body: new LongStream(LIMIT)
          });
        }
        const fulfilled = await Promise.all(calls);

        for (let i = 0; i < fulfilled.length; i++) {
          const [_req, res, next] = fulfilled[i];
          expect(res.statusCode).to.equal(201, `response ${i}`);
          expect(res.get('ETag')).to.match(/^".{6,128}"$/, `response ${i}`);
          expect(res._getBuffer().toString()).to.equal('', `response ${i}`);
          expect(next).not.to.have.been.called();
        }

        const [_folderReq, folderRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/category-all/folder-all/` });
        expect(folderRes.statusCode).to.equal(200);
        expect(folderRes.get('Content-Type')).to.equal('application/ld+json');
        const folder = JSON.parse(folderRes._getData());
        expect(folder['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        for (let i = 0; i < COUNT; i++) {
          expect(folder.items[`sibling-put-${i}`].ETag).to.match(/^"?[#-~!]{6,128}"?$/);
          expect(folder.items[`sibling-put-${i}`]['Content-Type']).to.equal(`text/${i}`);
          expect(folder.items[`sibling-put-${i}`]['Content-Length']).to.equal(LIMIT);
          expect(Math.abs(Date.parse(folder.items[`sibling-put-${i}`]['Last-Modified']) - Date.now())).to.be.lessThan(10 * 60 * 1000);
        }
        expect(Object.keys(folder.items).length).to.equal(COUNT);
        expect(folderRes.get('ETag')).to.match(/^"[#-~!]{6,128}"$/);

        const [_categoryReq, categoryRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/category-all/` });
        expect(categoryRes.statusCode).to.equal(200);
        expect(categoryRes.get('Content-Type')).to.equal('application/ld+json');
        const category = JSON.parse(categoryRes._getData());
        expect(category['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(category.items['folder-all/'].ETag).to.equal(stripQuotes(folderRes.get('ETag')));
        expect(Object.keys(category.items).length).to.equal(1);
        expect(categoryRes.get('ETag')).to.match(/^"[#-~!]{6,128}"$/);

        const [_rootReq, rootRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/` });
        expect(rootRes.statusCode).to.equal(200);
        expect(rootRes.get('Content-Type')).to.equal('application/ld+json');
        const root = rootRes._getJSONData();
        expect(root['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(root.items['category-all/'].ETag).to.equal(stripQuotes(categoryRes.get('ETag')));
        expect(rootRes.get('ETag')).to.match(/^"[#-~!]{6,128}"$/);

        const logNotes = new Set();
        const folderFromS3 = await this.handler.listFolder(this.userIdStore, '/category-all/folder-all/', true, logNotes);
        for (let i = 0; i < fulfilled.length; i++) {
          const res = fulfilled[i][1];
          expect(folderFromS3.items[`sibling-put-${i}`].ETag).to.equal(stripQuotes(res.get('ETag')));
        }
        expect(Object.keys(folderFromS3.items)).to.have.length(COUNT);
        expect(logNotes.size).to.equal(1); // listFolder always writes the target folder
      });
    });

    describe('for a nested document', function () {
      it('sets the value of a deep item & creates the ancestor folders', async function () {
        const content = 'mindless content';
        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/videos/foo/bar/qux`,
          headers: { 'Content-Length': content.length, 'Content-Type': 'text/example' },
          body: content
        });
        expect(putRes.statusCode).to.equal(201);
        expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
        expect(putRes._getBuffer().toString()).to.equal('');

        const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/videos/foo/bar/qux` });
        expect(getRes.statusCode).to.equal(200);
        expect(getRes._getBuffer().toString()).to.equal(content);
        expect(parseInt(getRes.get('Content-Length'))).to.equal(content.length);
        expect(getRes.get('Content-Type')).to.equal('text/example');
        expect(getRes.get('ETag')).to.equal(putRes.get('ETag'));

        const [_folderReq1, folderRes1] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/videos/foo/bar/` });
        expect(folderRes1.statusCode).to.equal(200);
        expect(folderRes1.get('Content-Type')).to.equal('application/ld+json');
        expect(folderRes1.get('ETag')).to.match(/^".{6,128}"$/);
        const folder1 = JSON.parse(folderRes1._getData());
        expect(folder1.items.qux['Content-Length']).to.be.equal(content.length);
        expect(folder1.items.qux['Content-Type']).to.be.equal('text/example');
        expect(folder1.items.qux.ETag).to.be.equal(stripQuotes(putRes.get('ETag')));
        expect(Date.now() - new Date(folder1.items.qux['Last-Modified'])).to.be.lessThan(15_000);

        const [_folderReq2, folderRes2] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/videos/foo/` });
        expect(folderRes2.statusCode).to.equal(200);
        expect(folderRes2.get('Content-Type')).to.equal('application/ld+json');
        expect(folderRes2.get('ETag')).to.match(/^".{6,128}"$/);
        const folder2 = JSON.parse(folderRes2._getData());
        expect(folder2.items['bar/']['Content-Length']).to.be.undefined;
        expect(folder2.items['bar/']['Content-Type']).to.be.undefined;
        expect(folder2.items['bar/'].ETag).to.be.equal(stripQuotes(folderRes1.get('ETag')));
        expect(folder2.items['bar/']['Last-Modified']).to.be.undefined;

        const [_folderReq3, folderRes3] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/videos/` });
        expect(folderRes3.statusCode).to.equal(200);
        expect(folderRes3.get('Content-Type')).to.equal('application/ld+json');
        expect(folderRes3.get('ETag')).to.match(/^".{6,128}"$/);
        const folder3 = JSON.parse(folderRes3._getData());
        expect(folder3.items['foo/']['Content-Length']).to.be.undefined;
        expect(folder3.items['foo/']['Content-Type']).to.be.undefined;
        expect(folder3.items['foo/'].ETag).to.be.equal(stripQuotes(folderRes2.get('ETag')));
        expect(folder3.items['foo/']['Last-Modified']).to.be.undefined;

        const [_folderReq4, folderRes4] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/` });
        expect(folderRes4.statusCode).to.equal(200);
        expect(folderRes4.get('Content-Type')).to.equal('application/ld+json');
        expect(folderRes4.get('ETag')).to.match(/^".{6,128}"$/);
        const folder4 = folderRes4._getJSONData();
        expect(folder4.items['videos/']['Content-Length']).to.be.undefined;
        expect(folder4.items['videos/']['Content-Type']).to.be.undefined;
        expect(folder4.items['videos/'].ETag).to.be.equal(stripQuotes(folderRes3.get('ETag')));
        expect(folder4.items['videos/']['Last-Modified']).to.be.undefined;
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
        expect(putRes2._getData()).to.match(/child of document/);

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
        expect(folderRes2._getData()).to.equal('is document, not folder');

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
        expect(putRes2._getData()).to.match(/is folder/);

        const [_getReq1, getRes1] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/photos/album` });
        expect(getRes1.statusCode).to.equal(409);
        expect(getRes1._getData()).to.equal('is actually folder: photos/album');
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
        expect(next).not.to.have.been.called();

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
        expect(next).not.to.have.been.called();

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
        expect(next).not.to.have.been.called();

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
    describe('unversioned', function () {
      it('should return Not Found for nonexistent user', async function () {
        const [_req, res, next] = await callMiddleware(this.handler, {
          method: 'DELETE',
          url: '/not-a-user/some-category/some-folder/some-thing'
        });

        expect(next).not.to.have.been.called();
        expect(res.statusCode).to.equal(404);
        expect(res._getBuffer().toString()).to.equal('');
        expect(Boolean(res.get('ETag'))).to.be.false;
      });

      it('should return Not Found for nonexistent path', async function () {
        const [_req, res, next] = await callMiddleware(this.handler, {
          method: 'DELETE',
          url: `/${this.userIdStore}/non-existent-category/non-existent-folder/non-existent-thing`
        });

        expect(next).not.to.have.been.called();
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

        expect(next).not.to.have.been.called();
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
        expect(next).not.to.have.been.called();

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
        const folder4 = JSON.parse(getRes4._getData());
        expect(folder4['@context']).to.equal('http://remotestorage.io/spec/folder-description');
        expect(folder4.items['europe/'].ETag).to.match(/^.{6,128}$/);

        const [_req2, res2, next2] = await callMiddleware(this.handler, {
          method: 'DELETE',
          url: `/${this.userIdStore}/animal/vertebrate/australia/marsupial/wombat`
        });
        expect(res2.statusCode).to.equal(404); // Not Found
        expect(res2._getBuffer().toString()).to.equal('');
        expect(res2.get('ETag')).to.equal(undefined);
        expect(next2).not.to.have.been.called();

        const [_req3, res3, next3] = await callMiddleware(this.handler, {
          method: 'DELETE',
          url: `/${this.userIdStore}/animal/vertebrate/australia/`
        });
        expect(res3.statusCode).to.equal(409); // Conflict
        expect(res3._getData()).to.equal('can\'t delete folder directly: animal/vertebrate/australia/');
        expect(res3.get('ETag')).to.equal(undefined);
        expect(next3).not.to.have.been.called();
      });

      // OpenIO (container) always fails this test.
      it('succeeds at simultaneous deleting', async function () {
        this.timeout(120_000);
        const LIMIT = 1_000_000;

        const [_putReq, putRes] = await callMiddleware(this.handler, {
          method: 'PUT',
          url: `/${this.userIdStore}/sim-cat/simultaneous-delete`,
          headers: { 'Content-Length': LIMIT, 'Content-Type': 'text/x-foo' },
          body: new LongStream(LIMIT)
        });
        expect(putRes.statusCode).to.equal(201);

        const [[_delReq1, delRes1, delNext1], [_delReq2, delRes2, delNext2]] = await Promise.all([
          callMiddleware(this.handler, { method: 'DELETE', url: `/${this.userIdStore}/sim-cat/simultaneous-delete` }),
          callMiddleware(this.handler, { method: 'DELETE', url: `/${this.userIdStore}/sim-cat/simultaneous-delete` })
        ]);
        expect(delRes1.statusCode).to.be.oneOf([204, 404]);
        expect(delRes1.get('ETag')).to.equal(delRes1.statusCode === 204 ? putRes.get('ETag') : undefined);
        expect(delRes1._getBuffer().toString()).to.equal('');
        expect(delNext1).not.to.have.been.called();

        expect(delRes2.statusCode).to.be.oneOf([204, 404]);
        expect(delRes2.get('ETag')).to.equal(delRes2.statusCode === 204 ? putRes.get('ETag') : undefined);
        expect(delRes2._getBuffer().toString()).to.equal('');
        expect(delNext2).not.to.have.been.called();

        const [_headReq, headRes] = await callMiddleware(this.handler, { method: 'HEAD', url: `/${this.userIdStore}/sim-cat/simultaneous-delete` });
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
        expect(next).not.to.have.been.called();
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
        expect(next).not.to.have.been.called();
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
        expect(next).not.to.have.been.called();
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
        expect(next).not.to.have.been.called();
      });
    });
  });
};

function stripQuotes (ETag) {
  return ETag.replace(/^"|^W\/"|"$/g, '');
}
