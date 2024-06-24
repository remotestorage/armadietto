/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */

const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const spies = require('chai-spies');
chai.use(spies);
const { configureLogger } = require('../../lib/logger');
const { shouldImplementOAuth } = require('../oauth.spec');
const express = require('express');
const oAuthRouter = require('../../lib/routes/oauth');
const path = require('path');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');

async function post (app, url, params) {
  return chai.request(app).post(url).type('form').send(params).redirects(0);
}

describe('OAuth (modular)', function () {
  before(async function () {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['debug'] });

    const mockAccount = {
      authenticate ({ username, email, password }) {
        if (username === 'zebcoe' && password === 'locog') { return; }
        throw new Error('Password and username do not match');
      }
    };

    this.hostIdentity = 'automated test';
    this.app = express();
    this.app.engine('.html', require('ejs').__express);
    this.app.set('view engine', 'html');
    this.app.set('views', path.join(__dirname, '../../lib/views'));

    this.app.use((_req, res, next) => {
      res.logNotes = new Set();
      next();
    });
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
    this.app.use('/oauth', oAuthRouter(this.hostIdentity, 'swordfish'));
    this.app.set('account', mockAccount);
    this.app.locals.title = 'Test Armadietto';
    this.app.locals.basePath = '';
    this.app.locals.host = 'localhost:xxxx';
    this.app.locals.signup = false;
  });

  shouldImplementOAuth();

  describe('with valid login credentials (new account module)', async function () {
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
        const { scopes } = jwt.verify(token, 'swordfish', { issuer: this.hostIdentity, audience: 'http://example.com', subject: 'zebcoe' });
        expect(scopes).to.equal('the_scope:rw');
      });
    });

    describe('with explicit read permission', async function () {
      it('authorizes the client to read', async function () {
        this.auth_params.scope = 'the_scope:r';
        const res = await post(this.app, '/oauth', this.auth_params);
        expect(res).to.redirect;
        const redirect = new URL(res.get('location'));
        const params = new URLSearchParams(redirect.hash.slice(1));
        const token = params.get('access_token');
        const { scopes } = jwt.verify(token, 'swordfish', { issuer: this.hostIdentity, audience: 'http://example.com', subject: 'zebcoe' });
        expect(scopes).to.equal('the_scope:r');
      });
    });

    describe('with explicit read/write permission', async function () {
      it('authorizes the client to read and write', async function () {
        this.auth_params.scope = 'the_scope:rw';
        const res = await post(this.app, '/oauth', this.auth_params);
        expect(res).to.redirect;
        const redirect = new URL(res.get('location'));
        const params = new URLSearchParams(redirect.hash.slice(1));
        const token = params.get('access_token');
        const { scopes } = jwt.verify(token, 'swordfish', { issuer: this.hostIdentity, audience: 'http://example.com', subject: 'zebcoe' });
        expect(scopes).to.equal('the_scope:rw');
      });
    });

    describe('with implicit root permission', async function () {
      it('authorizes the client to read and write', async function () {
        this.auth_params.scope = '*';
        const res = await post(this.app, '/oauth', this.auth_params);
        expect(res).to.redirect;
        const redirect = new URL(res.get('location'));
        const params = new URLSearchParams(redirect.hash.slice(1));
        const token = params.get('access_token');
        const { scopes } = jwt.verify(token, 'swordfish', { issuer: this.hostIdentity, audience: 'http://example.com', subject: 'zebcoe' });
        expect(scopes).to.equal('*:rw');
      });
    });

    describe('with multiple read/write permissions', async function () {
      it('authorizes the client to read and write nonexplicit scopes', async function () {
        this.auth_params.scope = 'first_scope second_scope:r third_scope:rw fourth_scope *:r';
        const res = await post(this.app, '/oauth', this.auth_params);
        expect(res).to.redirect;
        const redirect = new URL(res.get('location'));
        const params = new URLSearchParams(redirect.hash.slice(1));
        const token = params.get('access_token');
        const { scopes } = jwt.verify(token, 'swordfish', { issuer: this.hostIdentity, audience: 'http://example.com', subject: 'zebcoe' });
        expect(scopes).to.equal('first_scope:rw second_scope:r third_scope:rw fourth_scope:rw *:r');
      });
    });
  });
});
