/* eslint-env mocha, chai, node */
/* eslint no-unused-vars: ["warn", { "varsIgnorePattern": "^_", "argsIgnorePattern": "^_" }]  */
/* eslint-disable no-unused-expressions */

const chai = require('chai');
const expect = chai.expect;
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { configureLogger } = require('../../lib/logger');
const { mockAccountFactory, USER } = require('../util/mockAccount');
const path = require('path');
const loginFactory = require('../../lib/routes/login');
const accountRouterFactory = require('../../lib/routes/account');
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');

const HOST_IDENTITY = 'psteniusubi.github.io';

describe('account router', function () {
  before(async function () {
    configureLogger({ log_dir: './test-log', stdout: ['notice'], log_files: ['error'] });
    this.hostIdentity = HOST_IDENTITY;

    this.accountMgr = mockAccountFactory(HOST_IDENTITY);

    this.jwtSecret = 'scrimshaw';
    this.loginRouter = await loginFactory(this.hostIdentity, this.jwtSecret, this.accountMgr, false);
    this.accountRouter = await accountRouterFactory(this.hostIdentity, this.jwtSecret, this.accountMgr);

    this.app = express();
    this.app.locals.basePath = '';
    this.app.set('views', path.join(__dirname, '../../lib/views'));
    this.app.set('view engine', 'html');
    this.app.engine('.html', require('ejs').__express);

    const developSession = session({
      name: 'id',
      secret: crypto.randomBytes(32 / 8).toString('base64')
    });
    this.app.use(developSession);
    this.sessionValues = {};
    this.app.use((req, res, next) => { // shim for testing
      Object.assign(req.session, this.sessionValues);
      res.logNotes = new Set();
      next();
    });
    this.app.use('/account', this.loginRouter);
    this.app.use('/account', this.accountRouter);

    this.app.locals.title = 'Test Armadietto';
    this.app.locals.host = HOST_IDENTITY;
    this.app.locals.signup = false;
  });

  beforeEach(function () {
    this.sessionValues = { privileges: {} };
  });

  it('account page displays account data', async function () {
    this.sessionValues = { user: USER };
    const res = await chai.request(this.app).get('/account');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Content-Type', 'text/html; charset=utf-8');
    expect(res).to.have.header('Cache-Control', /\bprivate\b/);
    expect(res).to.have.header('Cache-Control', /\bno-cache\b/);
    const resText = res.text.replace(/&#34;/g, '"');
    expect(resText).to.contain('<h1>Your Account</h1>');
    expect(resText).to.match(new RegExp('<h1 class="fitName">' + USER.username + '@'));
    expect(resText).to.contain('<td>STORE</td>');
    expect(resText).to.contain('<td>Apple Mac Firefox</td>');
    expect(resText).to.match(/<td>5\/\d\/2024<\/td>/);
    expect(resText).to.contain('<td>never</td>');

    expect(resText).to.contain('To create a passkey on a new device, invite yourself to create another passkey');
    expect(resText).to.contain('data-username="nisar-dazan-dafig-kanih"');
    expect(resText).to.contain('data-contacturl="skype:skye"');
    expect(resText).to.contain('>Invite yourself to create another passkey</button>');
  });

  it('account page, when not logged in, redirect to login page', async function () {
    const res = await chai.request(this.app).get('/account');
    expect(res).to.redirectTo(/http:\/\/127.0.0.1:\d{1,5}\/account\/login/);
    expect(res).to.have.status(200);
    expect(res).to.have.header('Content-Type', 'text/html; charset=utf-8');
    const resText = res.text.replace(/&#34;/g, '"');
    expect(resText).to.contain('<h1>Login</h1>');
  });

  it('login page displays messages & contains options', async function () {
    const res = await chai.request(this.app).get('/account/login');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Content-Type', 'text/html; charset=utf-8');
    expect(res).to.have.header('Cache-Control', /\bprivate\b/);
    expect(res).to.have.header('Cache-Control', /\bno-store\b/);
    const resText = res.text.replace(/&#34;/g, '"');
    expect(resText).to.contain('<h1>Login</h1>');
    expect(resText).to.contain('<p id="message" class="preWrap">Click the button below to log in with a passkey.\n\nIf you need to create a passkey for this device or browser, log in from your old device and invite yourself to create a new passkey.</p>');
    expect(resText).to.contain('"challenge":"');
    expect(resText).to.contain('"userVerification":"preferred"');
    expect(resText).to.contain('"rpId":"psteniusubi.github.io"');
  });
});
