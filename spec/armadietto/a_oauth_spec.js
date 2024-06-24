/* eslint-env mocha, chai, node */

const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const spies = require('chai-spies');
chai.use(spies);
const Armadietto = require('../../lib/armadietto');
const { shouldImplementOAuth } = require('../oauth.spec');
const { configureLogger } = require('../../lib/logger');

const sandbox = chai.spy.sandbox();

async function post (app, url, params) {
  return chai.request(app).post(url).type('form').send(params).redirects(0);
}

const store = {
  authorize (_clientId, _username, _permissions) {
    return 'a_token';
  },
  authenticate ({ username, email, password }) {
    if (username === 'zebcoe' && password === 'locog') { return; }
    throw new Error('Incorrect password');
  }
};

describe('OAuth (monolithic)', function () {
  before(function () {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['debug'] });

    this.store = store;
    this.app = new Armadietto({
      bare: true,
      store,
      http: { },
      logging: { stdout: [], log_dir: './test-log', log_files: ['debug'] }
    });
  });

  shouldImplementOAuth();

  describe('with valid login credentials (old account module)', async function () {
    beforeEach(function () {
      this.auth_params = {
        username: 'zebcoe',
        password: 'locog',
        client_id: 'the_client_id',
        redirect_uri: 'http://example.com/cb',
        response_type: 'token',
        scope: 'the_scope',
        state: 'the_state'
      };

      sandbox.on(this.store, ['authorize', 'authenticate']);
    });

    afterEach(function () {
      sandbox.restore();
    });

    describe('without explicit read/write permissions', async function () {
      it('authorizes the client to read and write', async function () {
        await post(this.app, '/oauth', this.auth_params);
        expect(this.store.authorize).to.have.been.called.with('the_client_id', 'zebcoe', { the_scope: ['r', 'w'] });
      });
    });

    describe('with explicit read permission', async function () {
      it('authorizes the client to read', async function () {
        this.auth_params.scope = 'the_scope:r';
        await post(this.app, '/oauth', this.auth_params);
        expect(this.store.authorize).to.have.been.called.with('the_client_id', 'zebcoe', { the_scope: ['r'] });
      });
    });

    describe('with explicit read/write permission', async function () {
      it('authorizes the client to read and write', async function () {
        this.auth_params.scope = 'the_scope:rw';
        await post(this.app, '/oauth', this.auth_params);
        expect(this.store.authorize).to.have.been.called.with('the_client_id', 'zebcoe', { the_scope: ['r', 'w'] });
      });
    });
  });

  describe('with invalid login credentials (old account module)', async function () {
    beforeEach(function () {
      this.auth_params = {
        username: 'zebcoe',
        password: 'locog',
        client_id: 'the_client_id',
        redirect_uri: 'http://example.com/cb',
        response_type: 'token',
        scope: 'the_scope',
        state: 'the_state'
      };

      sandbox.on(this.store, ['authorize', 'authenticate']);
    });

    afterEach(function () {
      sandbox.restore();
    });

    it('does not authorize the client', async function () {
      this.auth_params.password = 'incorrect';
      await post(this.app, '/oauth', this.auth_params);
      expect(this.store.authorize).to.have.been.called.exactly(0);
    });
  });
});
