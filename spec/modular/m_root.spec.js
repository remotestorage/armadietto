const chai = require('chai');
const chaiHttp = require('chai-http');
const expect = chai.expect;
const app = require('../../lib/app');
const { configureLogger } = require('../../lib/logger');
const { shouldBeWelcomeWithoutSignup, shouldBeWelcomeWithSignup } = require('../root.spec');

/* eslint-env mocha */

chai.use(chaiHttp);

describe('root page (modular)', function () {
  describe('w/o signup', function () {
    beforeEach(function () {
      configureLogger({ log_dir: './test-log', stdout: [], log_files: ['error'] });

      this.app = app;
      this.app.locals.title = 'Armadietto without Signup';
      this.app.locals.basePath = '';
      this.app.locals.host = 'localhost:xxxx';
      this.app.locals.signup = false;
    });

    shouldBeWelcomeWithoutSignup();
  });

  describe('with signup', function () {
    beforeEach(function () {
      configureLogger({ log_dir: './test-log', stdout: [], log_files: ['error'] });

      this.app = app;
      this.app.locals.title = 'Armadietto with Signup';
      this.app.locals.basePath = '';
      this.app.locals.host = 'localhost:xxxx';
      this.app.locals.signup = true;
    });

    shouldBeWelcomeWithSignup();
  });

  /** This suite starts a server on an open port on each test */
  describe('Headers', () => {
    before(async () => {
      configureLogger({});

      app.locals.title = 'Test Armadietto';
      app.locals.basePath = '';
      app.locals.host = 'localhost:xxxx';
      app.locals.signup = false;
    });

    it('should return Welcome page w/ security headers', async () => {
      const res = await chai.request(app).get('/');
      expect(res).to.have.status(200);
      expect(res).to.have.header('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-popups allow-same-origin;default-src \'self\';script-src \'self\';script-src-attr \'none\';style-src \'self\';img-src \'self\';font-src \'self\';object-src \'none\';child-src \'none\';connect-src \'none\';base-uri \'self\';frame-ancestors \'none\';form-action https:;upgrade-insecure-requests');
      expect(res).to.have.header('Cross-Origin-Opener-Policy', 'same-origin');
      expect(res).to.have.header('Cross-Origin-Resource-Policy', 'same-origin');
      expect(res).to.have.header('Origin-Agent-Cluster');
      expect(res).to.have.header('Referrer-Policy', 'no-referrer');
      expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
      expect(res).to.have.header('Strict-Transport-Security', /^max-age=/);
      expect(res).not.to.have.header('X-Powered-By');
      expect(res).to.have.header('X-XSS-Protection', '0'); // disabled because counterproductive
      expect(res).to.have.header('Content-Type', /^text\/html/);
      expect(parseInt(res.get('Content-Length'))).to.be.greaterThan(2500);
      expect(res).to.have.header('ETag');
    });
  });
});
