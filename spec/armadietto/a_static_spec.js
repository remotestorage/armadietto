/* eslint-env mocha, chai, node */

const Armadietto = require('../../lib/armadietto');
const { shouldServeStaticFiles } = require('../static_files.spec');

const mockStore = {
  authorize (clientId, username, permissions) {
    return 'a_token';
  },
  authenticate (params) {
  }
};

describe('Static asset handler (monolithic)', function () {
  beforeEach(function () {
    this.app = new Armadietto({
      bare: true,
      store: mockStore,
      http: { },
      logging: { log_dir: './test-log', stdout: [], log_files: ['error'] }
    });
  });

  shouldServeStaticFiles();
});
