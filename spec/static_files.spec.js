/* eslint-env mocha, chai, node */

const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);

exports.shouldServeStaticFiles = function () {
  it('should return style sheet as text/css', async function () {
    const res = await chai.request(this.app).get('/assets/style.css');
    expect(res).to.have.status(200);
    // expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
    // expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    // expect(res).to.have.header('Strict-Transport-Security', /^max-age=/);
    expect(res).not.to.have.header('X-Powered-By');
    expect(res).to.have.header('Content-Type', /^text\/css/);
    expect(parseInt(res.get('Content-Length'))).to.be.greaterThan(16_000);
    // expect(res).to.have.header('ETag');
    expect(res.text).to.contain('body {');
    expect(res.text).to.contain('header.topbar {');
    expect(res.text).to.contain('section.hero {');
  });

  it('should return client javascript as text/javascript', async function () {
    const res = await chai.request(this.app).get('/assets/armadietto-utilities.js');
    expect(res).to.have.status(200);
    // expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
    // expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    // expect(res).to.have.header('Strict-Transport-Security', /^max-age=/);
    expect(res).not.to.have.header('X-Powered-By');
    // expect(res).to.have.header('Content-Type', /^text\/javascript/);
    expect(parseInt(res.get('Content-Length'))).to.be.greaterThan(1500);
    // expect(res).to.have.header('ETag');
    // expect(res.text).to.contain('function setTheme (');
    // expect(res.text).to.contain('function toggleTheme (');
    // expect(res.text).to.contain('document.getElementById(\'switch\').addEventListener(\'click\'');
  });
};
