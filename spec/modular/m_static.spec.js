/* eslint-env mocha */

const { mockAccountFactory } = require('../util/mockAccount');
const appFactory = require('../../lib/appFactory');
const { configureLogger } = require('../../lib/logger');
const { shouldServeStaticFiles } = require('../static_files.spec');

/** This suite starts a server on an open port on each test */
describe('Static asset handler (modular)', function () {
  before(async function () {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['error'] });

    const app = await appFactory({
      hostIdentity: 'autotest',
      jwtSecret: 'swordfish',
      accountMgr: mockAccountFactory('autotest'),
      storeRouter: (_req, _res, next) => next()
    });
    app.locals.title = 'Test Armadietto';
    app.locals.host = 'localhost:xxxx';
    app.locals.signup = false;
    this.app = app;
  });

  shouldServeStaticFiles();
});
