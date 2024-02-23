/* eslint-env mocha, chai, node */

const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);

exports.shouldHandleNonexistingResource = function () {
  it('should return 404 Not Found', async function () {
    const res = await chai.request(this.app).get('/zorp/gnu/');
    expect(res).to.have.status(404);
    // expect(res).to.have.header('Content-Security-Policy');
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    // expect(res).to.have.header('Strict-Transport-Security', /^max-age=/);
    expect(res).not.to.have.header('X-Powered-By');
    expect(res).to.have.header('Content-Type', /^text\/html/);
    expect(parseInt(res.get('Content-Length'))).to.be.greaterThan(1500);
    // expect(res).to.have.header('ETag');
    // expect(res.text).to.contain('<title>Not Found — Armadietto</title>');
    expect(res.text).to.match(/<h\d>Something went wrong<\/h\d>/);
    expect(res.text).to.contain('>404<');
    expect(res.text).to.contain('>“zorp/gnu/” doesn&#39;t exist<');

    // navigation
    expect(res.text).to.match(/<a [^>]*href="\/"[^>]*>Home<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/account"[^>]*>Account<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/signup"[^>]*>Sign up<\/a>/);
  });
};
