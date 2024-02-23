/* eslint-env mocha, chai, node */

const Armadietto = require('../../lib/armadietto');
const { shouldBeWelcomeWithoutSignup, shouldBeWelcomeWithSignup } = require('../root.spec');

const store = {
  authorize (clientId, username, permissions) {
    return 'a_token';
  },
  authenticate (params) {
  }
};

describe('root page (monolithic)', function () {
  describe('w/o signup', function () {
    beforeEach(function () {
      this.app = new Armadietto({
        bare: true,
        store,
        http: { },
        logging: { log_dir: './test-log', stdout: [], log_files: ['error'] }
      });
    });

    shouldBeWelcomeWithoutSignup();
  });

  describe('with signup', function () {
    beforeEach(function () {
      this.app = new Armadietto({
        bare: true,
        allow: { signup: true },
        store,
        http: { },
        logging: { log_dir: './test-log', stdout: [], log_files: ['error'] }
      });
    });

    shouldBeWelcomeWithSignup();
  });
});
