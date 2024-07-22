/* eslint-env mocha */

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-http'));
const { mockAccountFactory } = require('../util/mockAccount');
const appFactory = require('../../lib/appFactory');
const { configureLogger } = require('../../lib/logger');

describe('robots.txt', function () {
  before(async function () {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['error'] });

    const app = await appFactory({
      hostIdentity: 'autotest.ch',
      jwtSecret: 'swordfish',
      accountMgr: mockAccountFactory('autotest.ch'),
      storeRouter: (_req, _res, next) => next()
    });
    app.locals.title = 'Test Armadietto';
    app.locals.host = 'localhost:xxxx';
    app.locals.signup = false;
    this.app = app;
  });

  it('should serve robots.txt at expected location', async function () {
    const res = await chai.request(this.app).get('/robots.txt');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Content-Type', /^text\/plain/);
    expect(parseInt(res.get('Content-Length'))).to.be.greaterThan(0);

    expect(res.text).to.match(/^User-agent: \*$/m);
    expect(res.text).to.match(/^Disallow: \/$/m);
  });
});
