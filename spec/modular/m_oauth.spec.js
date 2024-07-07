/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */

const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const spies = require('chai-spies');
chai.use(spies);
const { configureLogger } = require('../../lib/logger');
const express = require('express');
const oAuthRouter = require('../../lib/routes/oauth');
const path = require('path');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const crypto = require('crypto');
const { mockAccountFactory, USER, CREDENTIAL_PRESENTED_WRONG, CREDENTIAL_PRESENTED_RIGHT_NO_USERHANDLE } = require('../util/mockAccount');

async function post (app, url, params) {
  return chai.request(app).post(url).type('form').send(params).redirects(0);
}

describe('OAuth (modular)', function () {
  before(async function () {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['debug'] });

    const mockAccount = mockAccountFactory('autotest');
    this.user = USER;

    this.hostIdentity = 'psteniusubi.github.io';
    this.app = express();
    this.app.engine('.html', require('ejs').__express);
    this.app.set('view engine', 'html');
    this.app.set('views', path.join(__dirname, '../../lib/views'));

    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          sandbox: ['allow-scripts', 'allow-forms', 'allow-popups', 'allow-same-origin'],
          defaultSrc: ['\'self\''],
          scriptSrc: ['\'self\''],
          scriptSrcAttr: ['\'none\''],
          styleSrc: ['\'self\''],
          imgSrc: ['\'self\''],
          fontSrc: ['\'self\''],
          objectSrc: ['\'none\''],
          childSrc: ['\'none\''],
          connectSrc: ['\'none\''],
          baseUri: ['\'self\''],
          frameAncestors: ['\'none\''],
          formAction: (process.env.NODE_ENV === 'production' ? ['https:'] : ['https:', 'http:']), // allows redirect to any RS app
          upgradeInsecureRequests: []
        }
      }
    }));
    this.app.use(express.urlencoded({ extended: true }));

    const developSession = session({
      secret: crypto.randomBytes(32 / 8).toString('base64')
    });
    this.app.use(developSession);
    this.sessionValues = {};
    this.app.use((req, res, next) => { // shim for testing
      for (const [key, value] of Object.entries(this.sessionValues)) {
        if (value instanceof Object) {
          req.session[key] = Object.assign(req.session[key] || {}, value);
        } else {
          req.session[key] = value;
        }
      }
      res.logNotes = new Set();
      next();
    });

    this.app.use('/oauth', oAuthRouter(this.hostIdentity, 'swordfish', mockAccount));
    this.app.set('accountMgr', mockAccount);
    this.app.locals.title = 'Test Armadietto';
    this.app.locals.basePath = '';
    this.app.locals.host = 'localhost:xxxx';
    this.app.locals.signup = false;
  });

  beforeEach(function () {
    this.sessionValues = { };
  });

  describe('authorization form', function () {
    beforeEach(function () {
      this.auth_params = {
        client_id: 'the_client_id',
        redirect_uri: 'http://example.com/cb',
        response_type: 'token',
        scope: 'data:rw',
        state: 'the_state'
      };
    });

    it('should ask for passkey, not password', async function () {
      const res = await chai.request(this.app).get('/oauth/' + this.user.username).query(this.auth_params);
      expect(res).to.have.status(200);
      expect(res).to.have.header('Cache-Control', /\bprivate\b/);
      expect(res).to.have.header('Cache-Control', /\bno-store\b/);
      expect(res.text).to.contain('>Authorize<');
      expect(res.text).to.contain('>the_client_id<');
      expect(res.text).to.contain('>example.com<');
      expect(res.text).to.match(/Read\/write.*access to.*\/data/);
      expect(res.text).not.to.contain('password');
      expect(res.text).to.contain('Use your passkey to authorize');
    });
  });

  describe('GETing with invalid client input', function () {
    beforeEach(function () {
      this.auth_params = {
        // username: this.user.username,
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
  });

  describe('POSTing with invalid login credentials', async function () {
    beforeEach(function () {
      this.auth_params = {
        credential: JSON.stringify(CREDENTIAL_PRESENTED_WRONG)
      };
      this.sessionValues.oauthParams = {
        username: this.user.username,
        challenge: '2LRuM9KrEZ-EkZHxOwu1w0TJEKQ',
        client_id: 'the_client_id',
        redirect_uri: 'http://example.com/cb',
        response_type: 'token',
        scope: 'the_scope',
        state: 'the_state',
        credential: JSON.stringify(CREDENTIAL_PRESENTED_WRONG)
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
      expect(res.text).to.contain('Presented credential does not belong to user.');
    });
  });

  describe('POSTing with valid login credentials (new accountMgr module)', async function () {
    beforeEach(function () {
      this.auth_params = {
        credential: JSON.stringify(CREDENTIAL_PRESENTED_RIGHT_NO_USERHANDLE)
      };
      this.sessionValues.oauthParams = {
        username: this.user.username,
        challenge: 'mJXERSBetL-NRL7AMozeWfnobXk',
        client_id: 'the_client_id',
        redirect_uri: 'http://example.com/cb',
        response_type: 'token',
        scope: 'the_scope',
        state: 'the_state',
        credential: JSON.stringify(CREDENTIAL_PRESENTED_RIGHT_NO_USERHANDLE)
      };
    });

    describe('without explicit read/write permissions', async function () {
      it('authorizes the client to read and write', async function () {
        const res = await post(this.app, '/oauth', this.auth_params);
        expect(res).to.redirect;
        const redirect = new URL(res.get('location'));
        expect(redirect.origin).to.equal('http://example.com');
        expect(redirect.pathname).to.equal('/cb');
        const params = new URLSearchParams(redirect.hash.slice(1));
        expect(params.get('token_type')).to.equal('bearer');
        expect(params.get('state')).to.equal('the_state');
        const token = params.get('access_token');
        const { scopes } = jwt.verify(token, 'swordfish', { issuer: this.hostIdentity, audience: 'http://example.com', subject: this.user.username });
        expect(scopes).to.equal('the_scope:rw');
      });
    });

    describe('with explicit read permission', async function () {
      it('authorizes the client to read', async function () {
        this.sessionValues.oauthParams.scope = 'the_scope:r';
        const res = await post(this.app, '/oauth', this.auth_params);
        expect(res).to.redirect;
        const redirect = new URL(res.get('location'));
        const params = new URLSearchParams(redirect.hash.slice(1));
        const token = params.get('access_token');
        const { scopes } = jwt.verify(token, 'swordfish', { issuer: this.hostIdentity, audience: 'http://example.com', subject: this.user.username });
        expect(scopes).to.equal('the_scope:r');
      });
    });

    describe('with explicit read/write permission', async function () {
      it('authorizes the client to read and write', async function () {
        this.sessionValues.oauthParams.scope = 'the_scope:rw';
        const res = await post(this.app, '/oauth', this.auth_params);
        expect(res).to.redirect;
        const redirect = new URL(res.get('location'));
        const params = new URLSearchParams(redirect.hash.slice(1));
        const token = params.get('access_token');
        const { scopes } = jwt.verify(token, 'swordfish', { issuer: this.hostIdentity, audience: 'http://example.com', subject: this.user.username });
        expect(scopes).to.equal('the_scope:rw');
      });
    });

    describe('with implicit root permission', async function () {
      it('authorizes the client to read and write', async function () {
        this.sessionValues.oauthParams.scope = '*';
        const res = await post(this.app, '/oauth', this.auth_params);
        expect(res).to.redirect;
        const redirect = new URL(res.get('location'));
        const params = new URLSearchParams(redirect.hash.slice(1));
        const token = params.get('access_token');
        const { scopes } = jwt.verify(token, 'swordfish', { issuer: this.hostIdentity, audience: 'http://example.com', subject: this.user.username });
        expect(scopes).to.equal('*:rw');
      });
    });

    describe('with multiple read/write permissions', async function () {
      it('authorizes the client to read and write nonexplicit scopes', async function () {
        this.sessionValues.oauthParams.scope = 'first_scope second_scope:r third_scope:rw fourth_scope *:r';
        const res = await post(this.app, '/oauth', this.auth_params);
        expect(res).to.redirect;
        const redirect = new URL(res.get('location'));
        const params = new URLSearchParams(redirect.hash.slice(1));
        const token = params.get('access_token');
        const { scopes } = jwt.verify(token, 'swordfish', { issuer: this.hostIdentity, audience: 'http://example.com', subject: this.user.username });
        expect(scopes).to.equal('first_scope:rw second_scope:r third_scope:rw fourth_scope:rw *:r');
      });
    });
  });

  describe('POSTing after session expired', async function () {
    it('tells the user to reload the page', async function () {
      this.auth_params = { credential: JSON.stringify(CREDENTIAL_PRESENTED_RIGHT_NO_USERHANDLE) };

      const res = await post(this.app, '/oauth', this.auth_params);

      expect(res).to.have.status(401);
      expect(res).to.have.header('Content-Type', 'text/html; charset=utf-8');
      expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);

      expect(res.text).to.contain('<title>Authorization Failure — Armadietto</title>');
      expect(res.text).to.contain('<p class="message">Go back to the app then try again — your session expired</p>');
    });
  });

  describe('GET then POST with valid login credentials', function () {
    it('should save OAuth params & read expiration from form input', async function () {
      const agent = chai.request.agent(this.app);

      const getAuthParams = {
        client_id: 'https://someclient.net',
        redirect_uri: 'http://example.com/cb',
        response_type: 'token',
        scope: 'data:rw',
        state: 'some_state'
      };
      const getRes = await agent.get('/oauth/' + this.user.username).query(getAuthParams);

      expect(getRes).to.have.status(200);
      expect(getRes).to.have.header('Cache-Control', /\bprivate\b/);
      expect(getRes).to.have.header('Cache-Control', /\bno-store\b/);

      this.sessionValues.oauthParams = { challenge: 'mJXERSBetL-NRL7AMozeWfnobXk' };
      const GRANT_DURATION_DAYS = 13;
      const postAuthParams = {
        credential: JSON.stringify(CREDENTIAL_PRESENTED_RIGHT_NO_USERHANDLE),
        grantDuration: String(GRANT_DURATION_DAYS)
      };
      const postRes = await agent.post('/oauth').type('form').send(postAuthParams).redirects(0);

      expect(postRes).to.redirect;
      const redirect = new URL(postRes.get('location'));
      const params = new URLSearchParams(redirect.hash.slice(1));
      const token = params.get('access_token');
      const { scopes, exp } = jwt.verify(token, 'swordfish', { issuer: this.hostIdentity, audience: 'http://example.com', subject: this.user.username });
      expect(scopes).to.equal(getAuthParams.scope);
      expect(exp * 1000 - Date.now()).to.be.greaterThan(0.99 * GRANT_DURATION_DAYS * 24 * 60 * 60 * 1000);
      expect(exp * 1000 - Date.now()).to.be.lessThan(1.01 * GRANT_DURATION_DAYS * 24 * 60 * 60 * 1000);

      await agent.close();
    });
  });
});
