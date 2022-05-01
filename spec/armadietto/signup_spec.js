/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */
const chai = require('chai');
const chaiHttp = require('chai-http');
const spies = require('chai-spies');
const expect = chai.expect;

const Armadietto = require('../../lib/armadietto');

chai.use(chaiHttp);
chai.use(spies);
const store = {
  async createUser (params) {
  }
};
const port = '4569';
const host = `http://127.0.0.1:${port}`;
const req = chai.request(host);

const get = async (path) => {
  const ret = await req.get(path).buffer(true);
  return ret;
};

describe('Home w/o signup and no base path', () => {
  before(async () => {
    this._server = new Armadietto({
      store,
      http: { port },
      logging: { log_dir: './test-log', stdout: [], log_files: ['notice'] }
    });
    await this._server.boot();
  });

  after(async () => {
    await this._server.stop();
  });

  it('returns a home page', async () => {
    const res = await get('/');
    expect(res).not.to.redirect;
    expect(res).to.have.status(200);
    expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    expect(res).to.be.html;
    expect(res.text).to.match(/Welcome.*Armadietto/i);
    expect(res.text).not.to.match(/<a .*href="\/signup"/);
    expect(res.text).to.match(/<a .*href="https:\/\/remotestorage.io\/"/);
    expect(res.text).to.match(/<a .*href="https:\/\/github.com\/remotestorage\/armadietto"/);
  });

  it('returns a style sheet', async () => {
    const res = await get('/assets/style.css');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Content-Type', 'text/css; charset=utf8');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
  });

  it('blocks access to the signup page', async () => {
    const res = await get('/signup');
    expect(res).to.have.status(403);
    expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    expect(res).to.be.html;
    expect(res.text).to.match(/Forbidden/);
  });

  it('blocks signup ', async () => {
    const res = await req.post('/signup').type('form').send({
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
});

describe('Signup w/ base path & signup', () => {
  before(async () => {
    this._server = new Armadietto({
      store,
      allow: { signup: true },
      http: { port },
      logging: { log_dir: './test-log', stdout: [], log_files: ['notice'] },
      basePath: '/basic'
    });
    await this._server.boot();
  });

  after(async () => {
    await this._server.stop();
  });

  it('redirects to the home page', async () => {
    const res = await get('');
    expect(res).to.redirect;
    expect(res).to.redirectTo('http://127.0.0.1:4569/basic');
  });

  it('returns a home page w/ signup link', async () => {
    const res = await get('/basic/');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    expect(res).to.be.html;
    expect(res.text).to.match(/<a .*href="\/basic\/signup"/);
    expect(res.text).to.match(/<a .*href="https:\/\/remotestorage.io\/"/);
    expect(res.text).to.match(/<a .*href="https:\/\/github.com\/remotestorage\/armadietto"/);
  });

  it('returns a signup page with form', async () => {
    const res = await get('/basic/signup');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    expect(res).to.be.html;
    expect(res.text).to.match(/Sign Up/i);
    expect(res.text).to.match(/<form .*action="\/basic\/signup"/);
  });

  it('allows signup ', async () => {
    const res = await req.post('/basic/signup').type('form').send({
      username: 'john',
      email: 'foo@bar.com',
      password: 'iloveyou'
    });
    expect(res).to.have.status(201);
    expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
    expect(res).to.have.header('Referrer-Policy', 'no-referrer');
    expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
    expect(res).to.be.html;
    expect(res.text).to.match(/signed up/);
  });
});
