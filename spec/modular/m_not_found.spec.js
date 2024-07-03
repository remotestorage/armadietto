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
      storeRouter: (_req, _res, next) => next()
    });
    app.locals.title = 'Test Armadietto';
    app.locals.host = 'localhost:xxxx';
    app.locals.signup = true;
    this.app = app;
  });

  shouldHandleNonexistingResource();

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
    expect(res).to.have.header('Content-Type', /^text\/html/);
    expect(parseInt(res.get('Content-Length'))).to.be.greaterThan(0);
    expect(res).to.have.header('ETag');
  });
});
