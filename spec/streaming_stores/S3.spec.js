/* eslint-env mocha, chai, node */

const S3 = require('../../lib/streaming_stores/S3');
const { shouldStream } = require('../streaming_store.spec');
const { configureLogger } = require('../../lib/logger');

describe('S3 streaming store', function () {
  before(function () {
    configureLogger({ stdout: [], log_dir: './test-log', log_files: ['debug'] });
    // If the environment variables aren't set, tests are run using a shared public account on play.min.io
    this.store = new S3(process.env.S3_HOSTNAME,
      process.env.S3_PORT ? parseInt(process.env.S3_PORT) : undefined,
      process.env.S3_ACCESS_KEY, process.env.S3_SECRET_KEY);
    this.username1 = 'unit-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    this.username2 = 'unit-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
  });

  after(async function () {
    await this.store.deleteUser(this.username1);
    await this.store.deleteUser(this.username2);
  });

  shouldStream();
});
