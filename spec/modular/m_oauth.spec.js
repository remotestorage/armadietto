/* eslint-env mocha, chai, node */

const { configureLogger } = require('../../lib/logger');
const { shouldImplementOAuth } = require('../oauth.spec');

const mockStore = {
  async authorize (_clientId, _username, _permissions) {
    return 'a_token';
  },
  async authenticate (params) {
  }
};

describe('OAuth (modular)', function () {
  before(async function () {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['debug'] });

    this.store = mockStore;

    this.app = require('../../lib/app');
    this.app.set('streaming store', this.store);
    this.app.locals.title = 'Test Armadietto';
    this.app.locals.basePath = '';
    this.app.locals.host = 'localhost:xxxx';
    this.app.locals.signup = false;
  });

  shouldImplementOAuth();
});
