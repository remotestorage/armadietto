// If a local S3 store isn't running and configured, tests are run using a shared public account on play.min.io
/* eslint-env mocha, chai, node */

const S3 = require('../../lib/streaming_stores/S3');
const { shouldStream } = require('../streaming_store.spec');
const { configureLogger } = require('../../lib/logger');

describe('S3 streaming store', function () {
  before(function () {
    configureLogger({ stdout: [], log_dir: './test-log', log_files: ['debug'] });
    // If the environment variables aren't set, tests are run using a shared public account on play.min.io
    this.store = new S3(process.env.S3_ENDPOINT,
      process.env.S3_ACCESS_KEY, process.env.S3_SECRET_KEY);
  });

  shouldStream();
});
