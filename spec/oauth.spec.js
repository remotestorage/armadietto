/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */
const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);

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
    });

    it('redirects with an access token', async function () {
      const res = await post(this.app, '/oauth', this.auth_params);
      // expect(res).to.redirectTo(/http:\/\/example\.com\/cb#access_token=[\w-]+&token_type=bearer&state=the_state/);
      expect(res).to.redirect;
      const redirect = new URL(res.get('location'));
      expect(redirect.origin).to.equal('http://example.com');
      expect(redirect.pathname).to.equal('/cb');
      const params = new URLSearchParams(redirect.hash.slice(1));
      expect(params.get('token_type')).to.equal('bearer');
      expect(params.get('state')).to.equal('the_state');
      expect(params.get('access_token')).to.match(/\S+/);
    });
  });

  describe('with invalid login credentials', async function () {
    beforeEach(function () {
      this.auth_params = {
        username: 'zebcoe',
        password: 'incorrect',
        client_id: 'the_client_id',
        redirect_uri: 'http://example.com/cb',
        response_type: 'token',
        scope: 'the_scope',
        state: 'the_state'
      };
    });

    it('returns a 401 response with the login form', async function () {
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
