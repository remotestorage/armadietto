// If a environment variables aren't set, tests are run using a shared public account on play.min.io
/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */

const chai = require('chai');
const expect = chai.expect;
const s3storeHandler = require('../../lib/routes/S3_store_router');
const { shouldStoreStreams } = require('../store_handler.spec');
const { configureLogger } = require('../../lib/logger');
const { shouldCreateDeleteAndReadAccounts } = require('../account.spec');

describe('S3 store router', function () {
  before(function () {
    configureLogger({ stdout: ['notice'], log_dir: './test-log', log_files: ['debug'] });
    this.USER_NAME_SUFFIX = '-java.extraordinary.org';
    // If the environment variables aren't set, tests are run using a shared public account on play.min.io
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
});
