/* eslint-env mocha, chai, node */

const { configureLogger } = require('../../lib/logger');
const { shouldBlockSignups, shouldAllowSignupsBasePath } = require('../signup.spec');
const core = require('../../lib/stores/core');
const appFactory = require('../../lib/appFactory');

const mockAccount = {

};

describe('Signup (modular)', function () {
  describe('w/ signup disabled', function () {
    before(async function () {
      configureLogger({ log_dir: './test-log', stdout: [], log_files: ['debug'] });

      const app = appFactory({ hostIdentity: 'autotest', jwtSecret: 'swordfish', account: mockAccount, storeRouter: (_req, _res, next) => next() });
      app.locals.title = 'Test Armadietto';
      app.locals.host = 'localhost:xxxx';
      app.locals.signup = false;
      this.app = app;
    });

    shouldBlockSignups();
  });

  describe('w/ base path & signup enabled', function () {
    before(async function () {
      configureLogger({ log_dir: './test-log', stdout: [], log_files: ['debug'] });

      this.storeRouter = {
        async createUser (params) {
          const errors = core.validateUser(params);
          if (errors.length > 0) throw new Error(errors[0]);
        }
      };

      delete require.cache[require.resolve('../../lib/appFactory')];
      const app = require('../../lib/appFactory')({
        jwtSecret: 'swordfish',
        account: mockAccount,
        storeRouter: (_req, _res, next) => next(),
        basePath: '/basic'
      });
      app.set('account', this.storeRouter);
      app.locals.title = 'Test Armadietto';
      app.locals.host = 'localhost:xxxx';
      app.locals.signup = true;
      this.app = app;
      this.username = 'john-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    });

    after(function () {
      delete require.cache[require.resolve('../../lib/appFactory')];
    });

    shouldAllowSignupsBasePath();
  });
});
