/* eslint-env mocha, chai, node */

const Armadietto = require('../../lib/armadietto');
const { shouldImplementOAuth } = require('../oauth.spec');

const store = {
  authorize (clientId, username, permissions) {
    return 'a_token';
  },
  authenticate (params) {
  }
};

describe('OAuth (monolithic)', function () {
  before(function () {
    this.store = store;
    this.app = new Armadietto({
      bare: true,
      store,
      http: { },
      logging: { stdout: [], log_dir: './test-log', log_files: ['debug'] }
    });
  });

  shouldImplementOAuth();
});
