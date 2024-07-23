/* eslint-env mocha, chai, node */

const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);

exports.shouldHandleNonexistingResource = function () {
  it('should return 404 Not Found', async function () {
    const res = await chai.request(this.app).get('/account/wildebeest/');
    expect(res).to.have.status(404);
    expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    // expect(res).to.have.header('Strict-Transport-Security', /^max-age=/);
    expect(res).not.to.have.header('X-Powered-By');
    expect(res).to.have.header('Content-Type', /^text\/html/);
    expect(parseInt(res.get('Content-Length'))).to.be.greaterThan(1500);
    // expect(res).to.have.header('Cache-Control', /\bmax-age=\d{4}/);
    // expect(res).to.have.header('ETag');
    expect(res.text).to.match(/<title>(Not Found|Something went wrong) — Armadietto<\/title>/i);
    expect(res.text).to.match(/<h\d>(Not Found|Something went wrong)<\/h\d>/i);
    expect(res.text).to.contain('>404<');
    expect(res.text).to.contain('>“account/wildebeest/” doesn&#39;t exist<');

    // navigation
    expect(res.text).to.match(/<a [^>]*href="\/"[^>]*>Home<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/account"[^>]*>Account<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/signup"[^>]*>Sign up<\/a>/);
  });
};
