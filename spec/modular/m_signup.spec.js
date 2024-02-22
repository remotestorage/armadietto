/* eslint-env mocha, chai, node */

const { configureLogger } = require('../../lib/logger');
const { shouldBlockSignups, shouldAllowSignupsBasePath } = require('../signup.spec');
const core = require('../../lib/stores/core');

describe('Signup (modular)', function () {
  describe('w/ signup disabled', function () {
    before(async function () {
      configureLogger({ log_dir: './test-log', stdout: [], log_files: ['debug'] });

      delete require.cache[require.resolve('../../lib/app')];
      const app = require('../../lib/app');
      app.locals.title = 'Test Armadietto';
      app.locals.basePath = '';
      app.locals.host = 'localhost:xxxx';
      app.locals.signup = false;
      this.app = app;
    });

    shouldBlockSignups();
  });

  describe('w/ base path & signup enabled', function () {
    before(async function () {
      configureLogger({ log_dir: './test-log', stdout: [], log_files: ['debug'] });

      this.store = {
        async createUser (params) {
          const errors = core.validateUser(params);
          if (errors.length > 0) throw new Error(errors[0]);
        }
      };

      process.env.basePath = 'basic';
      delete require.cache[require.resolve('../../lib/app')];
      const app = require('../../lib/app');
      app.set('streaming store', this.store);
      process.env.basePath = '';
      app.locals.title = 'Test Armadietto';
      app.locals.basePath = '/basic';
      app.locals.host = 'localhost:xxxx';
      app.locals.signup = true;
      this.app = app;
      this.username = 'john-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    });

    shouldAllowSignupsBasePath();
  });
});
