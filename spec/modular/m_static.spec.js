/* eslint-env mocha */

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-http'));
const { mockAccountFactory } = require('../util/mockAccount');
const appFactory = require('../../lib/appFactory');
const { configureLogger } = require('../../lib/logger');
const { shouldServeStaticFiles } = require('../static_files.spec');

/** This suite starts a server on an open port on each test */
describe('Static asset handler (modular)', function () {
  before(async function () {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['error'] });

    const app = await appFactory({
      hostIdentity: 'autotest',
      jwtSecret: 'swordfish',
      accountMgr: mockAccountFactory('autotest'),
      storeRouter: (_req, _res, next) => next()
    });
    app.locals.title = 'Test Armadietto';
    app.locals.host = 'localhost:xxxx';
    app.locals.signup = false;
    this.app = app;
  });

  shouldServeStaticFiles();

  it('should return security & caching headers', async function () {
    const res = await chai.request(this.app).get('/assets/outfit-variablefont_wght.woff2');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Content-Security-Policy', /\bsandbox\b/);
    expect(res).to.have.header('Content-Security-Policy', /\bdefault-src 'self';/);
    expect(res).to.have.header('Content-Security-Policy', /\bscript-src 'self';.*\bscript-src-attr 'none';/);
    expect(res).to.have.header('Content-Security-Policy', /\bstyle-src 'self';/);
    expect(res).to.have.header('Content-Security-Policy', /\bimg-src 'self';/);
    expect(res).to.have.header('Content-Security-Policy', /\bfont-src 'self';/);
    expect(res).to.have.header('Content-Security-Policy', /\bobject-src 'none';/);
    expect(res).to.have.header('Content-Security-Policy', /\bchild-src 'none';/);
    expect(res).to.have.header('Content-Security-Policy', /\bconnect-src 'self';/);
    expect(res).to.have.header('Content-Security-Policy', /\bbase-uri 'self';/);
    expect(res).to.have.header('Content-Security-Policy', /\bframe-ancestors 'none';/);
    expect(res).to.have.header('Content-Security-Policy', /\bform-action https: http:;/);
    expect(res).to.have.header('Content-Security-Policy', /\bupgrade-insecure-requests/);
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('Cross-Origin-Opener-Policy', 'same-origin');
    expect(res).to.have.header('Cross-Origin-Resource-Policy', 'same-origin');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    expect(res).to.have.header('Strict-Transport-Security', /^max-age=/);
    expect(res).not.to.have.header('X-Powered-By');
    expect(res).to.have.header('ETag');
    expect(res).to.have.header('Cache-Control', /max-age=\d{4}/);
    expect(res).to.have.header('Content-Type', /^font\/woff2/);
    expect(parseInt(res.get('Content-Length'))).to.be.greaterThan(20_000);
  });
});
