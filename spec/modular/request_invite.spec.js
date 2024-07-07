/* eslint-env mocha, chai, node */
/* eslint no-unused-vars: ["warn", { "varsIgnorePattern": "^_", "argsIgnorePattern": "^_" }]  */
/* eslint-disable no-unused-expressions */

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-spies'));
chai.use(require('chai-http'));
const { configureLogger } = require('../../lib/logger');
const { shouldBlockSignups } = require('../signup.spec');
const { mockAccountFactory } = require('../util/mockAccount');
const appFactory = require('../../lib/appFactory');
const path = require('path');

const INVITE_REQUEST_DIR = 'inviteRequests';

const mockAccount = mockAccountFactory('autotest');

describe('Request invite', function () {
  describe('w/ request disabled', function () {
    before(async function () {
      configureLogger({ log_dir: './test-log', stdout: [], log_files: ['debug'] });

      const storeRouter = (_req, _res, next) => next();
      storeRouter.upsertAdminBlob = chai.spy();
      const app = await appFactory({
        hostIdentity: 'autotest',
        jwtSecret: 'swordfish',
        accountMgr: mockAccount,
        storeRouter,
        adminDir: '/tmp/admin'
      });
      app.locals.title = 'Test Armadietto';
      app.locals.host = 'localhost:xxxx';
      app.locals.signup = false;
      this.app = app;
    });

    shouldBlockSignups();
  });

  describe('w/ base path & request enabled', function () {
    before(async function () {
      configureLogger({ log_dir: './test-log', stdout: [], log_files: ['debug'] });

      this.storeRouter = (_req, _res, next) => next();
      this.storeRouter.upsertAdminBlob = chai.spy();
      delete require.cache[require.resolve('../../lib/appFactory')];
      const app = await require('../../lib/appFactory')({
        hostIdentity: 'autotest.org',
        jwtSecret: 'swordfish',
        accountMgr: mockAccount,
        storeRouter: this.storeRouter,
        adminDir: '/tmp/admin',
        basePath: '/basic'
      });
      app.set('accountMgr', this.storeRouter);
      app.locals.title = 'Test Armadietto';
      app.locals.host = 'localhost:xxxx';
      app.locals.signup = true;
      this.app = app;

      this.username = 'john-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    });

    after(function () {
      delete require.cache[require.resolve('../../lib/appFactory')];
    });

    it('redirects to the home page', async function () {
      const res = await chai.request(this.app).get('/');
      expect(res).to.redirect;
      expect(res).to.redirectTo(/http:\/\/127.0.0.1:\d{1,5}\/basic/);
      expect(res).to.have.header('Cache-Control', /max-age=\d{4}/);
      expect(res).to.have.header('Cache-Control', /public/);
    });

    it('returns a home page w/ invite request link', async function () {
      const res = await chai.request(this.app).get('/basic/');
      expect(res).to.have.status(200);
      expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
      expect(res).to.have.header('Referrer-Policy', 'no-referrer');
      expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
      expect(res).to.be.html;
      expect(res.text).to.match(/<a [^>]*href="\/basic\/"[^>]*>Home<\/a>/);
      expect(res.text).to.match(/<a [^>]*href="\/basic\/account\/login"[^>]*>Log in<\/a>/);
      expect(res.text).to.match(/<a [^>]*href="\/basic\/signup"[^>]*>Request invite<\/a>/i);
      expect(res.text).to.match(/<a .*href="https:\/\/remotestorage.io\/"/);
      expect(res.text).to.match(/<a .*href="https:\/\/github.com\/remotestorage\/armadietto"/);
    });

    it('returns a signup page with empty form', async function () {
      const res = await chai.request(this.app).get('/basic/signup');
      expect(res).to.have.status(200);
      expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
      expect(res).to.have.header('Referrer-Policy', 'no-referrer');
      expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
      expect(res).to.have.header('Strict-Transport-Security', /^max-age=/);
      expect(res).not.to.have.header('X-Powered-By');
      expect(res).to.be.html;
      expect(parseInt(res.get('Content-Length'))).to.be.greaterThan(2000);
      expect(res).to.have.header('ETag');
      expect(res).to.have.header('Cache-Control', /max-age=\d{4}/);
      expect(res).to.have.header('Cache-Control', /public/);
      // content
      expect(res.text).to.contain('<title>Request an Invitation — Armadietto</title>');
      expect(res.text).to.match(/<h\d>Request an Invitation<\/h\d>/i);
      expect(res.text).to.match(/<form [^>]*method="post"[^>]*action="\/basic\/signup"/);
      expect(res.text).not.to.match(/<input [^>]*type="text"[^>]*name="username"[^>]*value=""/);
      expect(res.text).to.match(/>Protocol</i);
      expect(res.text).to.match(/<input [^>]*type="text"[^>]*name="address"[^>]*value=""/);
      expect(res.text).not.to.match(/<input [^>]*type="password"[^>]*name="password"[^>]*value=""/);
      expect(res.text).to.match(/<button [^>]*type="submit"[^>]*>Request invite<\/button>/);
      // navigation
      expect(res.text).to.match(/<a [^>]*href="\/basic\/"[^>]*>Home<\/a>/);
      expect(res.text).to.match(/<a [^>]*href="\/basic\/signup"[^>]*>Request invite<\/a>/i);
    });

    it('rejects signup with invalid protocol & re-displays form', async function () {
      const res = await chai.request(this.app).post('/basic/signup').type('form').send({
        protocol: '',
        address: 'somebody@somewhere.org'
      });
      expect(res).to.have.status(400);
      expect(res).to.have.header('Content-Length');
      expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
      expect(res).to.have.header('Referrer-Policy', 'no-referrer');
      expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
      expect(res).to.be.html;
      expect(res.text).to.contain('<title>Request Failure — Armadietto</title>');
      expect(res.text).to.contain('<p class="error">Invalid protocol</p>');
      expect(res.text).to.match(/<form [^>]*method="post"[^>]*action="\/basic\/signup"/);
      expect(res.text).to.match(/<input [^>]*type="text"[^>]*name="address"[^>]*value="somebody@somewhere.org"/);
      expect(res.text).to.match(/<button [^>]*type="submit"[^>]*>Request invite<\/button>/);
      // navigation
      expect(res.text).to.match(/<a [^>]*href="\/basic\/"[^>]*>Home<\/a>/);
      expect(res.text).to.match(/<a [^>]*href="\/basic\/signup"[^>]*>Request invite<\/a>/i);
    });

    it('rejects signup with blank address & re-displays form', async function () {
      const res = await chai.request(this.app).post('/basic/signup').type('form').send({
        protocol: 'sgnl:',
        address: '     '
      });
      expect(res).to.have.status(400);
      expect(res).to.have.header('Content-Length');
      expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
      expect(res).to.have.header('Referrer-Policy', 'no-referrer');
      expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
      expect(res).to.be.html;
      expect(res.text).to.contain('<title>Request Failure — Armadietto</title>');
      expect(res.text).to.contain('<p class="error">Missing address</p>');
      expect(res.text).to.match(/<form [^>]*method="post"[^>]*action="\/basic\/signup"/);
      expect(res.text).to.match(/<select name="protocol" id="protocol" value="sgnl:" required>/);
      expect(res.text).to.match(/<input [^>]*type="text"[^>]*name="address"[^>]*value=""/);
      expect(res.text).to.match(/<button [^>]*type="submit"[^>]*>Request invite<\/button>/);
      // navigation
      expect(res.text).to.match(/<a [^>]*href="\/basic\/"[^>]*>Home<\/a>/);
      expect(res.text).to.match(/<a [^>]*href="\/basic\/signup"[^>]*>Request invite<\/a>/i);
    });

    it('allows signup w/ Signal', async function () {
      this.timeout(10_000);
      const res = await chai.request(this.app).post('/basic/signup').type('form').send({
        protocol: 'sgnl:',
        address: '800-555-1212'
      });
      expect(res).to.have.status(201);
      expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
      expect(res).to.have.header('Referrer-Policy', 'no-referrer');
      expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
      expect(res).to.be.html;
      expect(res.text).to.match(/<h\d>Invitation Requested<\/h\d>/i);
      const EXPECTED_CONTACT_URL = 'sgnl://signal.me/#p/+18005551212';
      expect(res.text).to.contain(EXPECTED_CONTACT_URL);

      expect(this.storeRouter.upsertAdminBlob).to.have.been.called.with(path.join(INVITE_REQUEST_DIR, encodeURIComponent(EXPECTED_CONTACT_URL) + '.yaml'), 'application/yaml', EXPECTED_CONTACT_URL);
    });

    it('allows signup w/ Skype', async function () {
      this.timeout(10_000);
      const res = await chai.request(this.app).post('/basic/signup').type('form').send({
        protocol: 'skype:',
        address: 'live:.cid.933e6f00'
      });
      expect(res).to.have.status(201);
      expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
      expect(res).to.have.header('Referrer-Policy', 'no-referrer');
      expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
      expect(res).to.be.html;
      expect(res.text).to.match(/<h\d>Invitation Requested<\/h\d>/i);
      const EXPECTED_CONTACT_URL = 'skype:live:.cid.933e6f00';
      expect(res.text).to.contain(EXPECTED_CONTACT_URL);

      expect(this.storeRouter.upsertAdminBlob).to.have.been.called.with(path.join(INVITE_REQUEST_DIR, encodeURIComponent(EXPECTED_CONTACT_URL) + '.yaml'), 'application/yaml', EXPECTED_CONTACT_URL);
    });

    it('allows signup w/ email', async function () {
      this.timeout(10_000);
      const res = await chai.request(this.app).post('/basic/signup').type('form').send({
        protocol: 'mailto:',
        address: 'foo@bar.edu'
      });
      expect(res).to.have.status(201);
      expect(res).to.be.html;
      expect(res.text).to.match(/<h\d>Invitation Requested<\/h\d>/i);
      const EXPECTED_CONTACT_URL = 'mailto:foo@bar.edu';
      expect(res.text).to.contain(EXPECTED_CONTACT_URL);

      expect(this.storeRouter.upsertAdminBlob).to.have.been.called.with(path.join(INVITE_REQUEST_DIR, encodeURIComponent(EXPECTED_CONTACT_URL) + '.yaml'), 'application/yaml', EXPECTED_CONTACT_URL);
    });
  });
});
