// If a environment variables aren't set, tests are run using a shared public account on play.min.io
/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */

const chai = require('chai');
const expect = chai.expect;
const s3handler = require('../../lib/routes/S3Handler');
const { shouldStoreStream } = require('../streaming_handler.spec');
const { configureLogger } = require('../../lib/logger');
const { shouldCreateDeleteAndReadAccounts } = require('../account.spec');

describe('S3 streaming handler', function () {
  before(function () {
    configureLogger({ stdout: [], log_dir: './test-log', log_files: ['debug'] });
    this.USER_NAME_SUFFIX = '-java.extraordinary.org';
    // If the environment variables aren't set, tests are run using a shared public account on play.min.io
    this.handler = s3handler(process.env.S3_ENDPOINT, process.env.S3_ACCESS_KEY, process.env.S3_SECRET_KEY, undefined, this.USER_NAME_SUFFIX);
    this.store = this.handler;
  });

  shouldCreateDeleteAndReadAccounts();

  describe('createUser (S3-specific)', function () {
    it('rejects a user with too long a name for the user name suffix', async function () {
      const params = { username: 'a-------10--------20--------30--------40-', email: 'a@b.c', password: 'swordfish' };
      await expect(this.store.createUser(params)).to.be.rejectedWith(Error, '3–40 characters long');
    });
  });

  shouldStoreStream();
});
