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

describe('S3 store router', function () {
  before(function () {
    this.timeout(60_000);
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

  describe('folder caching', function () {
    before(async function () {
      this.timeout(15_000);

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
  });
});
