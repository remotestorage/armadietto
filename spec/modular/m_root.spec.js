const chai = require('chai');
const chaiHttp = require('chai-http');
const expect = chai.expect;
const appFactory = require('../../lib/appFactory');
const { configureLogger } = require('../../lib/logger');
const { shouldBeWelcomeWithoutSignup, shouldBeWelcomeWithSignup } = require('../root.spec');

/* eslint-env mocha */

chai.use(chaiHttp);

describe('root page (modular)', function () {
  describe('w/o signup', function () {
    beforeEach(function () {
      configureLogger({ log_dir: './test-log', stdout: [], log_files: ['error'] });

      this.app = appFactory({ hostIdentity: 'autotest', jwtSecret: 'swordfish', account: {}, storeRouter: (_req, _res, next) => next() });
      this.app.locals.title = 'Armadietto without Signup';
      this.app.locals.host = 'localhost:xxxx';
      this.app.locals.signup = false;
    });

    shouldBeWelcomeWithoutSignup();
  });

  describe('with signup', function () {
    beforeEach(function () {
      configureLogger({ log_dir: './test-log', stdout: [], log_files: ['error'] });

      this.app = appFactory({ hostIdentity: 'autotest', jwtSecret: 'swordfish', account: {}, storeRouter: (_req, _res, next) => next() });
      this.app.locals.title = 'Armadietto with Signup';
      this.app.locals.host = 'localhost:xxxx';
      this.app.locals.signup = true;
    });

    shouldBeWelcomeWithSignup();
  });

  /** This suite starts a server on an open port on each test */
  describe('Headers', () => {
    before(async () => {
      configureLogger({});

      this.app = appFactory({ hostIdentity: 'autotest', jwtSecret: 'swordfish', account: {}, storeRouter: (_req, _res, next) => next() });
      this.app.locals.title = 'Armadietto with Signup';
      this.app.locals.host = 'localhost:xxxx';
      this.app.locals.signup = true;
    });

    it('should return Welcome page w/ security headers', async () => {
      const res = await chai.request(this.app).get('/');
      expect(res).to.have.status(200);
      expect(res.get('Content-Security-Policy')).to.contain('sandbox allow-scripts allow-forms allow-popups allow-same-origin;');
      expect(res.get('Content-Security-Policy')).to.contain('default-src \'self\';');
      expect(res.get('Content-Security-Policy')).to.contain('script-src \'self\';');
      expect(res.get('Content-Security-Policy')).to.contain('script-src-attr \'none\';');
      expect(res.get('Content-Security-Policy')).to.contain('style-src \'self\';');
      expect(res.get('Content-Security-Policy')).to.contain('img-src \'self\';');
      expect(res.get('Content-Security-Policy')).to.contain('font-src \'self\';');
      expect(res.get('Content-Security-Policy')).to.contain('object-src \'none\';');
      expect(res.get('Content-Security-Policy')).to.contain('child-src \'none\';');
      expect(res.get('Content-Security-Policy')).to.contain('connect-src \'none\';');
      expect(res.get('Content-Security-Policy')).to.contain('base-uri \'self\';');
      expect(res.get('Content-Security-Policy')).to.contain('frame-ancestors \'none\';');
      expect(res.get('Content-Security-Policy')).to.contain('form-action https:'); // in dev may also allow http:
      expect(res.get('Content-Security-Policy')).to.contain('upgrade-insecure-requests');
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
