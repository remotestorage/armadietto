/* eslint-env mocha, chai, node */

const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);

exports.shouldBeWelcomeWithoutSignup = function () {
  it('should return Welcome page w/o signup link, when signup:false', async function welcomeWithout () {
    const res = await chai.request(this.app).get('/');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    // expect(res).to.have.header('Strict-Transport-Security', /^max-age=/);
    expect(res).not.to.have.header('X-Powered-By');
    expect(res).to.have.header('Content-Type', /^text\/html/);
    expect(parseInt(res.get('Content-Length'))).to.be.greaterThan(2500);
    // expect(res).to.have.header('ETag');
    expect(res.text).to.contain('<title>Welcome — Armadietto</title>');
    expect(res.text).to.match(/<h\d>Welcome to Armadietto!<\/h\d>/);
    expect(res.text).to.match(/<a [^>]*href="\/"[^>]*>127.0.0.1:\d{1,5}<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/"[^>]*>Home<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/account"[^>]*>Account<\/a>/);
    expect(res.text).not.to.contain('Sign up');
    expect(res.text).to.match(/<a [^>]*href="https:\/\/remotestorage.io\/"/);
    expect(res.text).to.match(/<a [^>]*href="https:\/\/github.com\/remotestorage\/armadietto"/);
  });
};

exports.shouldBeWelcomeWithSignup = function () {
  it('should return Welcome page w/ signup link, when signup:true', async function () {
    const res = await chai.request(this.app).get('/');
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
};
