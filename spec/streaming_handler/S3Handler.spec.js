// If a environment variables aren't set, tests are run using a shared public account on play.min.io
/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */

const s3handler = require('../../lib/routes/S3Handler');
const { shouldStoreStream } = require('../streaming_handler.spec');
const { configureLogger } = require('../../lib/logger');
const { shouldCreateDeleteAndReadAccounts } = require('../account.spec');

describe('S3 streaming handler', function () {
  before(function () {
    configureLogger({ stdout: [], log_dir: './test-log', log_files: ['debug'] });
    // If the environment variables aren't set, tests are run using a shared public account on play.min.io
    this.handler = s3handler(process.env.S3_ENDPOINT, process.env.S3_ACCESS_KEY, process.env.S3_SECRET_KEY);
    this.store = this.handler;
  });

  shouldCreateDeleteAndReadAccounts();

  shouldStoreStream();
});
