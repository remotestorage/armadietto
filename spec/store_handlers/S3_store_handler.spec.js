// If a environment variables aren't set, tests are run using a shared public account on play.min.io
/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */
/* eslint no-unused-vars: ["warn", { "varsIgnorePattern": "^_", "argsIgnorePattern": "^_" }]  */

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));
const { posix } = require('node:path');
const s3storeHandler = require('../../lib/routes/S3_store_router');
const { shouldStoreStreams } = require('../store_handler.spec');
const { configureLogger } = require('../../lib/logger');
const { shouldCreateDeleteAndReadAccounts } = require('../account.spec');
const callMiddleware = require('../util/callMiddleware');
const { NoSuchKey } = require('@aws-sdk/client-s3');

const BLOB_PREFIX = 'remoteStorageBlob/';
const CONTENT_TYPE_SEPARATOR = '!'; // separates Content-Type from path

function calcTypeCachePath (itemS3Path, contentType) {
  return itemS3Path + CONTENT_TYPE_SEPARATOR + encodeURIComponent(contentType).replaceAll('%', '!');
}

describe('S3 store router', function () {
  this.timeout(60_000);

  before(function () {
    configureLogger({ stdout: ['notice'], log_dir: './test-log', log_files: ['debug'] });
    this.USER_NAME_SUFFIX = '-java.extraordinary.test';
    // If the environment variables aren't set, tests are run using a shared public account on play.min.io
    console.info(`creating s3storeHandler with endpoint “${process.env.S3_ENDPOINT}”, accessKey “${process.env.S3_ACCESS_KEY}”, & region “${process.env.S3_REGION}”`);
    this.handler = s3storeHandler({ endPoint: process.env.S3_ENDPOINT, accessKey: process.env.S3_ACCESS_KEY, secretKey: process.env.S3_SECRET_KEY, region: process.env.S3_REGION || 'us-east-1', userNameSuffix: this.USER_NAME_SUFFIX });
    this.accountMgr = this.store = this.handler;
  });

  shouldCreateDeleteAndReadAccounts();

  describe('createUser (S3-specific)', function () {
    it('rejects a user with too long an ID', async function () {
      const params = { username: 'aiiiiiii10iiiiiiii20iiiiiiii30iiiiiiii40iiiiiiii50iiiiiiii60iiii', contactURL: 'mailto:a@b.c' };
      const logNotes = new Set();
      await expect(this.store.createUser(params, logNotes)).to.be.rejectedWith(Error, 'characters long');
    });
  });

  shouldStoreStreams();

  describe('folder & Content-Type caching', function () {
    before(async function () {
      const usernameStore = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
      const user = await this.store.createUser({ username: usernameStore, contactURL: 'p@q.rr' }, new Set());
      this.userIdStore = user.username;
      this.bucketName = user.username + this.USER_NAME_SUFFIX;
    });

    after(async function () {
      this.timeout(360_000);
      await this.store.deleteUser(this.userIdStore, new Set());
    });

    it("doesn't cache folder after PUT, but does after GET", async function () {
      const categoryPath = 's3cat/';
      const rsPath = posix.join(categoryPath, 's3fold/s3doc');
      const content = 'aufgenehmen';
      const [_putReq, putRes] = await callMiddleware(this.handler, {
        method: 'PUT',
        url: `/${this.userIdStore}/${rsPath}`,
        headers: { 'Content-Length': content.length, 'Content-Type': 'text/vnd.zoo.kcl' },
        body: content
      });
      expect(putRes.statusCode).to.equal(201);
      expect(putRes.get('ETag')).to.match(/^".{6,128}"$/);
      expect(putRes._getData()).to.equal('');

      await expect(this.store.readJson(this.bucketName, posix.join(BLOB_PREFIX, categoryPath)))
        .to.be.rejectedWith(NoSuchKey);

      const [_getReq, getRes] = await callMiddleware(this.handler, { method: 'GET', url: `/${this.userIdStore}/${categoryPath}` });
      expect(getRes.statusCode).to.equal(200);
      expect(getRes.get('Content-Type')).to.equal('application/ld+json');
      const category = getRes._getJSONData();
      expect(category['@context']).to.equal('http://remotestorage.io/spec/folder-description');
      expect(Object.keys(category.items)).to.have.length(1);

      const category2 = await this.store.readJson(this.bucketName, posix.join(BLOB_PREFIX, categoryPath));
      expect(category2).to.deep.equal(category);
    });

    it('caches and reads Content-Type as Key of 0-length blob, when building folder data', async function () {
      const categoryPath = 'some-cat/';
      const folderPath = posix.join(categoryPath, 'some-folder/');
      const rsPath = posix.join(folderPath, 'some-doc');
      const content = 'rambunctious';
      const contentType = 'video/webm; codecs="vp8, vorbis"';
      const [_putReq, putRes] = await callMiddleware(this.handler, {
        method: 'PUT',
        url: `/${this.userIdStore}/${rsPath}`,
        headers: { 'Content-Length': content.length, 'Content-Type': contentType },
        body: content
      });
      expect(putRes.statusCode).to.equal(201);

      // tests that type cache blob has not been created yet
      const typeCachePath = calcTypeCachePath(posix.join(BLOB_PREFIX, rsPath), contentType);
      await expect(this.store.readJson(this.bucketName, typeCachePath))
        .to.be.rejectedWith(NoSuchKey);

      // GETs category, which caches type
      const [_catReq, catRes] = await callMiddleware(this.handler, {
        method: 'GET',
        url: `/${this.userIdStore}/${categoryPath}`
      });
      expect(catRes.statusCode).to.equal(200);

      // tests that type cache blob exists
      await expect(this.store.readJson(this.bucketName, typeCachePath))
        .to.be.rejectedWith(SyntaxError); // 0-length

      // tests that type cache blob does not show up as a folder item
      const [_folderReq, folderRes] = await callMiddleware(this.handler, {
        method: 'GET',
        url: `/${this.userIdStore}/${folderPath}`
      });
      expect(folderRes.statusCode).to.equal(200);
      const folder = JSON.parse(folderRes._getBuffer().toString());
      expect(Object.keys(folder.items)).to.have.length(1);

      const content2 = 'changed';
      const [_putReq2, putRes2] = await callMiddleware(this.handler, {
        method: 'PUT',
        url: `/${this.userIdStore}/${rsPath}`,
        headers: { 'Content-Length': content2.length, 'Content-Type': contentType },
        body: content
      });
      expect(putRes2.statusCode).to.equal(200);
      expect(putRes2.get('ETag')).not.to.equal(putRes.get('ETag'));

      // exercises listFolder; checking that type cache object is used must use the debugger
      const [_folderReq2, folderRes2] = await callMiddleware(this.handler, {
        method: 'GET',
        url: `/${this.userIdStore}/${folderPath}`
      });
      expect(folderRes2.statusCode).to.equal(200);
      const folder2 = folderRes2._getJSONData();
      expect(Object.keys(folder2.items)).to.have.length(1);
    });

    it('deletes the old Content-Type cache when updating a document', async function () {
      const category = 'content/';
      const name = 'odd thing';
      const content1 = 'lymphatic';
      const contentType1 = 'application/json; charset=UTF-8';
      const [_putReq1, putRes1] = await callMiddleware(this.handler, {
        method: 'PUT',
        url: `/${this.userIdStore}/${category}${name}`,
        headers: { 'Content-Length': content1.length, 'Content-Type': contentType1 },
        body: content1
      });
      expect(putRes1.statusCode).to.equal(201);

      const logNotes1 = new Set();
      const folder1 = await this.handler.listFolder(this.userIdStore, '/' + category, true, logNotes1);
      expect(folder1.items[name]['Content-Type']).to.equal(contentType1);

      // tests that type cache blob exists
      const typeCachePath1 = calcTypeCachePath(posix.join(BLOB_PREFIX, category, name), contentType1);
      await expect(this.store.readJson(this.bucketName, typeCachePath1))
        .to.be.rejectedWith(SyntaxError); // 0-length

      const content2 = 'orogeny';
      const contentType2 = 'text/plain; x-mac-type="54455854"; x-mac-creator="4D4F5353"';
      const [_putReq2, putRes2] = await callMiddleware(this.handler, {
        method: 'PUT',
        url: `/${this.userIdStore}/${category}${name}`,
        headers: { 'Content-Length': content2.length, 'Content-Type': contentType2 },
        body: content2
      });
      expect(putRes2.statusCode).to.equal(200);

      // tests that both old and new type cache blobs no longer exist
      await expect(this.store.readJson(this.bucketName, typeCachePath1))
        .to.be.rejectedWith(NoSuchKey);
      const typeCachePath2 = calcTypeCachePath(posix.join(BLOB_PREFIX, category, name), contentType2);
      await expect(this.store.readJson(this.bucketName, typeCachePath2))
        .to.be.rejectedWith(NoSuchKey);

      // getting the folder forces S3 store to cache folder & type
      const logNotes2 = new Set();
      const folder2 = await this.handler.listFolder(this.userIdStore, category, true, logNotes2);
      expect(logNotes2.size).to.equal(1);
      expect(folder2.items[name]['Content-Type']).to.equal(contentType2);

      // tests that the new type cache blob exists
      await expect(this.store.readJson(this.bucketName, typeCachePath2))
        .to.be.rejectedWith(SyntaxError); // 0-length
    });

    it('deletes Content-Type cache blob when deleting document', async function () {
      const categoryPath = 'another_cat/';
      const folderPath = posix.join(categoryPath, 'another_folder/');
      const rsPath1 = posix.join(folderPath, 'star');
      const rsPath2 = posix.join(folderPath, 'starshine');
      const content1 = 'rambunctious';
      const content2 = 'ambidextrous';
      const contentType1 = 'text/t140';
      const contentType2 = 'text/spdx';
      const [_putReq1, putRes1] = await callMiddleware(this.handler, {
        method: 'PUT',
        url: `/${this.userIdStore}/${rsPath1}`,
        headers: { 'Content-Length': content1.length, 'Content-Type': contentType1 },
        body: content1
      });
      expect(putRes1.statusCode).to.equal(201);
      const [_putReq2, putRes2] = await callMiddleware(this.handler, {
        method: 'PUT',
        url: `/${this.userIdStore}/${rsPath2}`,
        headers: { 'Content-Length': content2.length, 'Content-Type': contentType2 },
        body: content2
      });
      expect(putRes2.statusCode).to.equal(201);

      // GETs category, which caches type
      const [_catReq, catRes] = await callMiddleware(this.handler, {
        method: 'GET',
        url: `/${this.userIdStore}/${categoryPath}`
      });
      expect(catRes.statusCode).to.equal(200);

      // tests that type cache blob exists
      const typeCachePath1 = calcTypeCachePath(posix.join(BLOB_PREFIX, rsPath1), contentType1);
      await expect(this.store.readJson(this.bucketName, typeCachePath1))
        .to.be.rejectedWith(SyntaxError); // 0-length
      const typeCachePath2 = calcTypeCachePath(posix.join(BLOB_PREFIX, rsPath2), contentType2);
      await expect(this.store.readJson(this.bucketName, typeCachePath2))
        .to.be.rejectedWith(SyntaxError); // 0-length

      // deletes one document
      const [_deleteReq, deleteRes] = await callMiddleware(this.handler, {
        method: 'DELETE',
        url: `/${this.userIdStore}/${rsPath1}`
      });
      expect(deleteRes.statusCode).to.equal(204);

      // tests that one type cache blob was deleted and the other remains
      await expect(this.store.readJson(this.bucketName, typeCachePath2))
        .to.be.rejectedWith(SyntaxError); // 0-length
      await expect(this.store.readJson(this.bucketName, typeCachePath1))
        .to.be.rejectedWith(NoSuchKey);
    });
  });
});
