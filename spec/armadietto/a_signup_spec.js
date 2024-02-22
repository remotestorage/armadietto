/* eslint-env mocha, chai, node */

const Armadietto = require('../../lib/armadietto');
const { shouldBlockSignups, shouldAllowSignupsBasePath } = require('../signup.spec');
const core = require('../../lib/stores/core');

const store = {
  async createUser (params) {
    const errors = core.validateUser(params);
    if (errors.length > 0) throw new Error(errors[0]);
  }
};

describe('Signup (monolithic)', function () {
  describe('Signup disabled and no base path', function () {
    before(function () {
      this.app = new Armadietto({
        bare: true,
        store,
        http: { },
        logging: { log_dir: './test-log', stdout: [], log_files: ['notice'] }
      });
    });

    // test of home page w/ signup disabled moved to root.spec.js

    // test that style sheet can be fetched moved to static_files.spec.js

    shouldBlockSignups();
  });

  describe('Signup w/ base path & signup enabled', function () {
    before(function () {
      this.app = new Armadietto({
        bare: true,
        store,
        allow: { signup: true },
        http: { },
        logging: { log_dir: './test-log', stdout: [], log_files: ['notice'] },
        basePath: '/basic'
      });
      this.username = 'john';
    });

    shouldAllowSignupsBasePath();
  });
});
