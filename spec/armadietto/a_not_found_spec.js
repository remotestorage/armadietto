/* eslint-env mocha, chai, node */

const Armadietto = require('../../lib/armadietto');
const { shouldHandleNonexistingResource } = require('../not_found.spec');

const mockStore = {
  authorize (clientId, username, permissions) {
    return 'a_token';
  },
  authenticate (params) {
  }
};

describe('Nonexistant resource (monolithic)', function () {
  beforeEach(function () {
    this.app = new Armadietto({
      bare: true,
      store: mockStore,
      allow: { signup: true },
      http: { },
      logging: { log_dir: './test-log', stdout: [], log_files: ['error'] }
    });
  });

  shouldHandleNonexistingResource();
});
