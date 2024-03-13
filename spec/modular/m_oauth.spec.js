/* eslint-env mocha, chai, node */

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

    this.session = {};
    const session = this.session;

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
    this.app.use(express.urlencoded({ extended: false }));
    this.app.use(function (req, _res, next) { // mock session restore
      req.sessionID = 'some-session-token';
      req.session = session; next();
    });
    this.app.use('/oauth', oAuthRouter);
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
        await post(this.app, '/oauth', this.auth_params);
        expect(this.session.permissions).to.deep.equal({ the_scope: ['r', 'w'] });
      });
    });

    describe('with explicit read permission', async function () {
      it('authorizes the client to read', async function () {
        this.auth_params.scope = 'the_scope:r';
        await post(this.app, '/oauth', this.auth_params);
        expect(this.session.permissions).to.deep.equal({ the_scope: ['r'] });
      });
    });

    describe('with explicit read/write permission', async function () {
      it('authorizes the client to read and write', async function () {
        this.auth_params.scope = 'the_scope:rw';
        await post(this.app, '/oauth', this.auth_params);
        expect(this.session.permissions).to.deep.equal({ the_scope: ['r', 'w'] });
        // expect(this.store.authorize).to.have.been.called.with('the_client_id', 'zebcoe', { the_scope: ['r', 'w'] });
      });
    });
  });
});
