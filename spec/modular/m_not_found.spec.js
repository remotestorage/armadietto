const app = require('../../lib/app');
const { configureLogger } = require('../../lib/logger');
const { shouldHandleNonexistingResource } = require('../not_found.spec');

/* eslint-env mocha */

/** This suite starts a server on an open port on each test */
describe('Nonexistant resource (modular)', function () {
  before(async function () {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['error'] });

    app.locals.title = 'Test Armadietto';
    app.locals.basePath = '';
    app.locals.host = 'localhost:xxxx';
    app.locals.signup = true;
    this.app = app;
  });

  shouldHandleNonexistingResource();
});
