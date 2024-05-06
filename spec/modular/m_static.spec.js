/* eslint-env mocha */

const appFactory = require('../../lib/appFactory');
const { configureLogger } = require('../../lib/logger');
const { shouldServeStaticFiles } = require('../static_files.spec');

/** This suite starts a server on an open port on each test */
describe('Static asset handler (modular)', function () {
  before(function () {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['error'] });

    const app = appFactory({ hostIdentity: 'autotest', jwtSecret: 'swordfish', account: {}, storeRouter: (_req, _res, next) => next() });
    app.locals.title = 'Test Armadietto';
    app.locals.host = 'localhost:xxxx';
    app.locals.signup = false;
    this.app = app;
  });

  shouldServeStaticFiles();
});
