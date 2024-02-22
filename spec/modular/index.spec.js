const chai = require('chai');
const chaiHttp = require('chai-http');
const expect = chai.expect;
const app = require('../../lib/app');
const { configureLogger } = require('../../lib/logger');

/* eslint-env mocha */

chai.use(chaiHttp);

/** This suite starts a server on an open port on each test */
describe('Root path', () => {
  before(async () => {
    configureLogger({});

    app.locals.title = 'Test Armadietto';
    app.locals.basePath = '';
    app.locals.host = 'localhost:xxxx';
  });

  it('should return Welcome page w/o signup link, when signup:false', async () => {
    app.locals.signup = false;
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
    expect(res.text).to.contain('<title>Welcome — Armadietto</title>');
    expect(res.text).to.match(/<h\d>Welcome to Armadietto!<\/h\d>/);
    expect(res.text).to.match(/<a [^>]*href="\/"[^>]*>127.0.0.1:\d{1,5}<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/"[^>]*>Home<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/account"[^>]*>Account<\/a>/);
    expect(res.text).not.to.contain('Sign up');
    expect(res.text).to.match(/<a [^>]*href="https:\/\/remotestorage.io\/"/);
    expect(res.text).to.match(/<a [^>]*href="https:\/\/github.com\/remotestorage\/armadietto"/);
  });

  it('should return Welcome page w/ signup link, when signup:true', async () => {
    app.locals.signup = true;
    const res = await chai.request(app).get('/');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Content-Type', /^text\/html/);
    expect(parseInt(res.get('Content-Length'))).to.be.greaterThan(2500);
    expect(res.text).to.contain('<title>Welcome — Armadietto</title>');
    expect(res.text).to.match(/<h\d>Welcome to Armadietto!<\/h\d>/);
    expect(res.text).to.match(/<a [^>]*href="\/"[^>]*>127.0.0.1:\d{1,5}<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/"[^>]*>Home<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/account"[^>]*>Account<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/signup"[^>]*>Sign up<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="https:\/\/remotestorage.io\/"/);
    expect(res.text).to.match(/<a [^>]*href="https:\/\/github.com\/remotestorage\/armadietto"/);
  });
});
