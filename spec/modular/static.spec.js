const chai = require('chai');
const chaiHttp = require('chai-http');
const expect = chai.expect;
const app = require('../../lib/app');
const { configureLogger } = require('../../lib/logger');

/* eslint-env mocha */

chai.use(chaiHttp);

/** This suite starts a server on an open port on each test */
describe('Static asset handler', () => {
  before(async () => {
    configureLogger({});

    app.locals.title = 'Test Armadietto';
    app.locals.basePath = '';
    app.locals.host = 'localhost:xxxx';
    app.locals.signup = false;
  });

  it('should return style sheet as text/css w/ secure headers', async () => {
    const res = await chai.request(app).get('/assets/style.css');
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
    expect(res).to.have.header('Content-Type', /^text\/css/);
    expect(parseInt(res.get('Content-Length'))).to.be.greaterThan(16_000);
    expect(res).to.have.header('ETag');
    expect(res.text).to.contain('body {');
    expect(res.text).to.contain('header.topbar {');
    expect(res.text).to.contain('section.hero {');
  });

  it('should return client javascript as text/javascript w/ secure headers', async () => {
    const res = await chai.request(app).get('/assets/armadietto-utilities.js');
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
    expect(res).to.have.header('Content-Type', /^text\/javascript/);
    expect(parseInt(res.get('Content-Length'))).to.be.greaterThan(1500);
    expect(res).to.have.header('ETag');
    expect(res.text).to.contain('function setTheme (');
    expect(res.text).to.contain('function toggleTheme (');
    expect(res.text).to.contain('document.getElementById(\'switch\').addEventListener(\'click\'');
  });
});
