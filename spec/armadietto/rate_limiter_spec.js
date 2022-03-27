/* eslint-env mocha, chai, node */
const chai = require('chai');
const chaiHttp = require('chai-http');
const spies = require('chai-spies');
const expect = chai.expect;
const chaiAsPromised = require('chai-as-promised');
const Armadietto = require('../../lib/armadietto');

chai.use(chaiHttp);
chai.use(chaiAsPromised);
chai.use(spies);

// const req = chai.request('http://localhost:4568');
const store = {
  get (username, path) {
    return { item: null, versionMatch: true };
  },
  permissions (user, token) {
    if (user === 'zebcoe' && token === 'a_token') {
      return {
        '/data': ['r']
      };
    }
  }
};

const RateLimiter = require('../../lib/extensions/rate_limiter/rate_limiter');
RateLimiter.connect = () => {};
RateLimiter.rateLimiterRedis = {};

/**
 * Below is the `opts` options object passed to Armadietto to intialize and dependency inject.  E.g. we
 * dependency inject `store` below.
 *
 * Middleware is also dependency injected in the same fashion as the `middleware` array.
 *
 * You can see this done in each test below, where we dependency inject an array of some combination of the
 * above sample classes.
 */
const opts = {
  store,
  http: { port: 4567 },
  logging: { log_dir: './test-log', stdout: [], log_files: ['error'] },
  middleware: [RateLimiter],
  extensions: {
    rate_limiter: {
      enabled: true
    }
  }
};

const sandbox = chai.spy.sandbox();
describe('rate_limiter', () => {
  beforeEach((done) => {
    (async () => {
      sandbox.on(store, ['get']);
      done();
    })();
  });

  afterEach((done) => {
    (async () => {
      sandbox.restore();
      done();
    })();
  });

  const req = chai.request('http://localhost:4567');

  const get = async (path) => {
    const ret = await req.get(path)
      .set('Authorization', 'Bearer a_token').send();
    return ret;
  };

  it('rate limit storage request', async () => {
    const server = new Armadietto(opts); /* no middleware stack setup for this test */
    await server.boot();

    const err = 'throttle';
    sandbox.on(RateLimiter.rateLimiterRedis, 'consume', () => { throw err; });
    const ret = await get('/storage/zebcoe@local.dev/data');
    expect(RateLimiter.rateLimiterRedis.consume).to.have.been.called.exactly(1);
    expect(ret.statusCode).to.eql(429);
    await server.stop();
  });

  it('pass rate limit during storage request', async () => {
    const server = new Armadietto(opts); /* no middleware stack setup for this test */
    await server.boot();
    sandbox.on(RateLimiter.rateLimiterRedis, 'consume', () => {});
    const ret = await get('/storage/zebcoe@local.dev/data');
    expect(RateLimiter.rateLimiterRedis.consume).to.have.been.called.exactly(1);
    expect(ret.statusCode).to.not.eql(429);
    await server.stop();
  });

  it('pass rate limit for storage OPTIONS request', async () => {
    const server = new Armadietto(opts); /* no middleware stack setup for this test */
    await server.boot();
    const err = 'throttle';
    sandbox.on(RateLimiter.rateLimiterRedis, 'consume', () => { throw err; });
    const ret = await req.options('/storage/zebcoe@local.dev/data');
    expect(RateLimiter.rateLimiterRedis.consume).to.have.been.called.exactly(0);
    expect(ret.statusCode).to.not.eql(429);
    await server.stop();
  });

  it('pass rate limit for non-storage request', async () => {
    const server = new Armadietto(opts); /* no middleware stack setup for this test */
    await server.boot();
    sandbox.on(RateLimiter.rateLimiterRedis, 'consume', () => {});
    const ret = await req.options('/blah');
    expect(RateLimiter.rateLimiterRedis.consume).to.have.been.called.exactly(0);
    expect(ret.statusCode).to.not.eql(429);
    await server.stop();
  });
});
