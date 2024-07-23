const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-http'));
const { mockAccountFactory } = require('../util/mockAccount');
const appFactory = require('../../lib/appFactory');
const { configureLogger } = require('../../lib/logger');
const { shouldHandleNonexistingResource } = require('../not_found.spec');

/* eslint-env mocha */

/** This suite starts a server on an open port on each test */
describe('Nonexistant resource (modular)', function () {
  before(async function () {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['error'] });

    this.hostIdentity = 'autotest.us';
    const app = await appFactory({
      hostIdentity: this.hostIdentity,
      jwtSecret: 'swordfish',
      accountMgr: mockAccountFactory(this.hostIdentity),
      storeRouter: (_req, res, _next) => { res.status(404).end(); }
    });
    app.locals.title = 'Test Armadietto';
    app.locals.host = 'localhost:xxxx';
    app.locals.signup = true;
    this.app = app;
  });

  shouldHandleNonexistingResource();

  /** This extends the test in shouldHandleNonexistingResource */
  it('should say cacheable for 25 minutes', async function () {
    const res = await chai.request(this.app).get('/account/wildebeest/');
    expect(res).to.have.status(404);
    expect(res).to.have.header('Cache-Control', /max-age=\d{4}/);
    expect(res).to.have.header('Strict-Transport-Security', /^max-age=/);
    expect(res).to.have.header('ETag');

    expect(res.text).to.contain('<title>Not Found — Armadietto</title>');
    expect(res.text).to.contain('>“account/wildebeest/” doesn&#39;t exist<');
  });

  it('should curtly & cache-ably refuse to serve unlikely paths', async function () {
    const res = await chai.request(this.app).get('/_profiler/phpinfo');
    expect(res).to.have.status(404);
    expect(res).to.have.header('Cache-Control', /max-age=\d{4}/);
    expect(res.text).to.equal('');
  });

  it('should curtly refuse POSTs without a handler', async function () {
    const res = await chai.request(this.app).post('/admin/login');
    expect(res).to.have.status(404);
    expect(res.text).to.equal('');
  });

  /** This tests that 404 for nonexistent assets is cache-able */
  it('should return cache headers for asset', async function () {
    const res = await chai.request(this.app).get('/assets/not-there').set('Origin', this.hostIdentity);
    expect(res).to.have.status(404);
    expect(res).to.have.header('Cache-Control', /max-age=\d{4}/);
    expect(res).to.have.header('Cache-Control', /public/);
    expect(res.text).to.equal('');
  });

  /** This tests that /storage paths have tighter security (except allow cross-origin) than other paths */
  it('should return security headers', async function () {
    const res = await chai.request(this.app).get('/storage/zebcoe/public/nonexistant')
      .set('Origin', this.hostIdentity);
    expect(res).to.have.status(404);
    expect(res.get('Content-Security-Policy')).to.contain('sandbox allow-orientation-lock;');
    expect(res.get('Content-Security-Policy')).to.contain('default-src \'none\';');
    expect(res.get('Content-Security-Policy')).to.contain('script-src \'none\';');
    expect(res.get('Content-Security-Policy')).to.contain('script-src-attr \'none\';');
    expect(res.get('Content-Security-Policy')).to.contain('style-src \'self\';');
    expect(res.get('Content-Security-Policy')).to.contain('img-src \'self\';');
    expect(res.get('Content-Security-Policy')).to.contain('font-src \'self\';');
    // expect(res.get('Content-Security-Policy')).to.contain(`style-src 'self' ${this.hostIdentity};`);
    // expect(res.get('Content-Security-Policy')).to.contain(`img-src 'self' ${this.hostIdentity};`);
    // expect(res.get('Content-Security-Policy')).to.contain(`font-src 'self' ${this.hostIdentity};`);
    expect(res.get('Content-Security-Policy')).to.contain('object-src \'none\';');
    expect(res.get('Content-Security-Policy')).to.contain('child-src \'none\';');
    expect(res.get('Content-Security-Policy')).to.contain('connect-src \'none\';');
    expect(res.get('Content-Security-Policy')).to.contain('base-uri \'self\';');
    expect(res.get('Content-Security-Policy')).to.contain('frame-ancestors \'none\';');
    expect(res.get('Content-Security-Policy')).to.contain('form-action \'none\'');
    expect(res.get('Content-Security-Policy')).to.contain('upgrade-insecure-requests');
    expect(res).not.to.have.header('Cross-Origin-Resource-Policy');
    expect(res).to.have.header('Cross-Origin-Opener-Policy', 'same-origin');
    expect(res).to.have.header('Origin-Agent-Cluster');
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    expect(res).to.have.header('Strict-Transport-Security', /^max-age=/);
    expect(res).not.to.have.header('X-Powered-By');
    expect(res).to.have.header('X-XSS-Protection', '0'); // disabled because counterproductive

    expect(res).to.have.header('Cache-Control', /\bno-cache\b/);
    expect(res).to.have.header('Cache-Control', /\bpublic\b/);
  });

  /** This tests that the 404 for /favicon.ico is cacheable */
  it('should curtly, finally & cache-ably refuse to serve /favicon.ico', async function () {
    const res = await chai.request(this.app).get('/favicon.ico');
    expect(res).to.have.status(404);
    expect(res).to.have.header('Cache-Control', /max-age=\d{8}/);
    expect(res).to.have.header('Cache-Control', /public/);
    expect(res.text).to.equal('');
  });
});
