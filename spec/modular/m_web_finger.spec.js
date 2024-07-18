/* eslint-env mocha, chai, node */

const { mockAccountFactory } = require('../util/mockAccount');
const http = require('http');
const { configureLogger } = require('../../lib/logger');
const { shouldImplementWebFinger } = require('../web_finger.spec');
const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-http'));

describe('Web Finger (modular)', function () {
  before(async function () {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['debug'] });

    this.app = await require('../../lib/appFactory')({
      hostIdentity: 'autotest.org',
      jwtSecret: 'swordfish',
      accountMgr: mockAccountFactory('autotest.org'),
      storeRouter: (_req, _res, next) => next()
    });
    this.app.locals.title = 'Test Armadietto';
    this.app.locals.host = 'localhost:xxxx';
    this.app.locals.signup = false;
    this.server = http.createServer(this.app);
    this.server.listen();

    await new Promise(resolve => {
      this.server.on('listening', () => {
        this.port = this.server.address().port;
        this.host = this.server.address().address + ':' + this.server.address().port;
        resolve();
      });
    });
  });

  after(function (done) {
    this.server.close(done);
  });

  shouldImplementWebFinger();

  it('redirects change-password to /signup', async function () {
    const res = await chai.request(this.app).get('/.well-known/change-password');
    expect(res).to.redirectTo(/^http:\/\/127.0.0.1:\d{1,5}\/signup$/);
  });
});
