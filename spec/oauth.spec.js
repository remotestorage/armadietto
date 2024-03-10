/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */
const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const spies = require('chai-spies');
chai.use(spies);

const sandbox = chai.spy.sandbox();

async function post (app, url, params) {
  return chai.request(app).post(url).type('form').send(params).redirects(0);
}

exports.shouldImplementOAuth = function () {
  describe('with invalid client input', function () {
    beforeEach(function () {
      this.auth_params = {
        username: 'zebcoe',
        password: 'locog',
        client_id: 'the_client_id',
        redirect_uri: 'http://example.com/cb',
        response_type: 'token',
        scope: 'the_scope'
        // no state
      };

      sandbox.on(this.store, ['authorize', 'authenticate']);
    });

    afterEach(function () {
      sandbox.restore();
    });

    it('returns an error if redirect_uri is missing', async function () {
      delete this.auth_params.redirect_uri;
      const res = await chai.request(this.app).get('/oauth/me').query(this.auth_params);
      expect(res).to.have.status(400);
      expect(res.text).to.equal('error=invalid_request&error_description=Required%20parameter%20%22redirect_uri%22%20is%20missing');
    });

    it('returns an error if client_id is missing', async function () {
      delete this.auth_params.client_id;
      const res = await chai.request(this.app).get('/oauth/me').query(this.auth_params);
      expect(res).to.redirectTo('http://example.com/cb#error=invalid_request&error_description=Required%20parameter%20%22client_id%22%20is%20missing');
    });

    it('returns an error if response_type is missing', async function () {
      delete this.auth_params.response_type;
      const res = await chai.request(this.app).get('/oauth/me').query(this.auth_params);
      expect(res).to.redirectTo('http://example.com/cb#error=invalid_request&error_description=Required%20parameter%20%22response_type%22%20is%20missing');
    });

    it('returns an error if response_type is not recognized', async function () {
      this.auth_params.response_type = 'wrong';
      const res = await chai.request(this.app).get('/oauth/me').query(this.auth_params);
      expect(res).to.redirectTo('http://example.com/cb#error=unsupported_response_type&error_description=Response%20type%20%22wrong%22%20is%20not%20supported');
    });

    it('returns an error if scope is missing', async function () {
      delete this.auth_params.scope;
      const res = await chai.request(this.app).get('/oauth/me').query(this.auth_params);
      expect(res).to.redirectTo('http://example.com/cb#error=invalid_scope&error_description=Parameter%20%22scope%22%20is%20invalid');
    });

    it('returns an error if username is missing', async function () {
      delete this.auth_params.username;
      const res = await post(this.app, '/oauth', this.auth_params);
      expect(res).to.have.status(400);
    });
  });

  describe('with valid login credentials', async function () {
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
        // expect(this.store.authorize).to.have.been.called.with('the_client_id', 'zebcoe', { the_scope: ['r', 'w'] });
      });
    });

    describe('with explicit read permission', async function () {
      it('authorizes the client to read', async function () {
        this.auth_params.scope = 'the_scope:r';
        await post(this.app, '/oauth', this.auth_params);
        // expect(this.store.authorize).to.have.been.called.with('the_client_id', 'zebcoe', { the_scope: ['r'] });
      });
    });

    describe('with explicit read/write permission', async function () {
      it('authorizes the client to read and write', async function () {
        this.auth_params.scope = 'the_scope:rw';
        await post(this.app, '/oauth', this.auth_params);
        // expect(this.store.authorize).to.have.been.called.with('the_client_id', 'zebcoe', { the_scope: ['r', 'w'] });
      });
    });

    it('redirects with an access token', async function () {
      const res = await post(this.app, '/oauth', this.auth_params);
      expect(res).to.redirectTo(/http:\/\/example\.com\/cb#access_token=[\w-]+&token_type=bearer&state=the_state/);
    });
  });

  describe('with invalid login credentials', async function () {
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
      this.store.authenticate = async function (_params) {
        throw new Error();
      };
      await post(this.app, '/oauth', this.auth_params);
      expect(this.store.authorize).to.have.been.called.exactly(0);
    });

    it('returns a 401 response with the login form', async function () {
      this.store.authenticate = async function (_params) {
        throw new Error();
      };
      const res = await post(this.app, '/oauth', this.auth_params);
      expect(res).to.have.status(401);
      expect(res).to.have.header('Content-Type', 'text/html; charset=utf-8');
      expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
      expect(res).to.have.header('Referrer-Policy', 'no-referrer');
      expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
      expect(res.text).to.contain('application <em>the_client_id</em> hosted');
    });
  });
};
