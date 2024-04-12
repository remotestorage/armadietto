/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */
const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);

// arrow functions are incompatible with sharing tests
exports.shouldBlockSignups = function () {
  it('blocks access to the signup page', async function () {
    const res = await chai.request(this.app).get('/signup');
    expect(res).to.have.status(403);
    expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    expect(res).to.be.html;
    expect(res.text).to.match(/Forbidden/);
    expect(res.text).to.match(/(Signing up|Requesting invite) is not allowed currently/);
    // navigation
    expect(res.text).to.match(/<a [^>]*href="\/"[^>]*>Home<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/account"[^>]*>Account<\/a>/);
    expect(res.text).not.to.contain('Sign up');
  });

  it('blocks signup ', async function () {
    const res = await chai.request(this.app).post('/signup').type('form').send({
      username: '123',
      email: 'foo@bar.com',
      password: 'iloveyou'
    });

    expect(res).to.have.status(403);
    expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    expect(res).to.be.html;
    expect(res.text).to.match(/Forbidden/);
  });
};

exports.shouldAllowSignupsBasePath = function () {
  it('redirects to the home page', async function () {
    const res = await chai.request(this.app).get('/');
    expect(res).to.redirect;
    expect(res).to.redirectTo(/http:\/\/127.0.0.1:\d{1,5}\/basic/);
  });

  it('returns a home page w/ signup link', async function () {
    const res = await chai.request(this.app).get('/basic/');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    expect(res).to.be.html;
    expect(res.text).to.match(/<a [^>]*href="\/basic\/"[^>]*>Home<\/a>/);
    // expect(res.text).to.match(/<a [^>]*href="\/basic\/account"[^>]*>Account<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/basic\/signup"[^>]*>Sign up<\/a>/);
    expect(res.text).to.match(/<a .*href="https:\/\/remotestorage.io\/"/);
    expect(res.text).to.match(/<a .*href="https:\/\/github.com\/remotestorage\/armadietto"/);
  });

  it('returns a signup page with empty form', async function () {
    const res = await chai.request(this.app).get('/basic/signup');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    // expect(res).to.have.header('Strict-Transport-Security', /^max-age=/);
    expect(res).not.to.have.header('X-Powered-By');
    expect(res).to.be.html;
    expect(parseInt(res.get('Content-Length'))).to.be.greaterThan(2500);
    // expect(res).to.have.header('ETag');
    // content
    expect(res.text).to.contain('<title>Signup — Armadietto</title>');
    expect(res.text).to.match(/<h\d>Sign up<\/h\d>/i);
    expect(res.text).to.match(/<form [^>]*method="post"[^>]*action="\/basic\/signup"/);
    expect(res.text).to.match(/<input [^>]*type="text"[^>]*name="username"[^>]*value=""/);
    expect(res.text).to.match(/<input [^>]*type="text"[^>]*name="email"[^>]*value=""/);
    expect(res.text).to.match(/<input [^>]*type="password"[^>]*name="password"[^>]*value=""/);
    expect(res.text).to.match(/<button [^>]*type="submit"/);
    // navigation
    expect(res.text).to.match(/<a [^>]*href="\/basic\/"[^>]*>Home<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/basic\/account"[^>]*>Account<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/basic\/signup"[^>]*>Sign up<\/a>/i);
  });

  it('rejects signup with illegal characters in username & redisplays form', async function () {
    const res = await chai.request(this.app).post('/basic/signup').type('form').send({
      username: 'b!b',
      email: 'z@y.x',
      password: 'qwerty'
    });
    expect(res).to.have.status(409);
    expect(res).to.have.header('Content-Length');
    expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    expect(res).to.be.html;
    expect(res.text).to.contain('<title>Signup Failure — Armadietto</title>');
    expect(res.text).to.match(/Username/i);
    expect(res.text).to.match(/<h\d>Sign up<\/h\d>/i);
    expect(res.text).to.match(/<form [^>]*method="post"[^>]*action="\/basic\/signup"/);
    expect(res.text).to.match(/<input [^>]*type="text"[^>]*name="username"[^>]*value="b!b"/);
    expect(res.text).to.match(/<input [^>]*type="text"[^>]*name="email"[^>]*value="z@y.x"/);
    expect(res.text).to.match(/<input [^>]*type="password"[^>]*name="password"[^>]*value=""/);
    expect(res.text).to.match(/<button [^>]*type="submit"/);
    // navigation
    expect(res.text).to.match(/<a [^>]*href="\/basic\/"[^>]*>Home<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/basic\/account"[^>]*>Account<\/a>/);
    expect(res.text).to.match(/<a [^>]*href="\/basic\/signup"[^>]*>Sign up<\/a>/i);
  });

  it('allows signup', async function () {
    this.timeout(10_000);
    const res = await chai.request(this.app).post('/basic/signup').type('form').send({
      username: this.username,
      email: 'foo@bar.com',
      password: 'iloveyou'
    });
    expect(res).to.have.status(201);
    expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    expect(res).to.be.html;
    expect(res.text).to.match(/signed up/i);
  });
};
