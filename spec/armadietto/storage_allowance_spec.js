/* eslint-env mocha, chai, node */
const chai = require('chai');
const chaiHttp = require('chai-http');
const spies = require('chai-spies');
const expect = chai.expect;
const chaiAsPromised = require('chai-as-promised');
const qs = require('querystring');
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
        '/data': ['r', 'w']
      };
    }
  },
  getSize () {
    return 500;
  }
};

const StorageAllowance = require('../../lib/extensions/storage_allowance/storage_allowance');
StorageAllowance.connect = () => {};
StorageAllowance.consumptionLimiterRedis = {};

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
  middleware: [StorageAllowance],
  extensions: {
    storage_allowance: {
      enabled: true,
      salt: 'c0c0nut',
      max_bytes: 1000
    }
  }
};

const sandbox = chai.spy.sandbox();
describe('storage_allowance', () => {
  beforeEach((done) => {
    (async () => {
      sandbox.on(store, ['get']);
      sandbox.on(store, 'put', () => { return { created: '', modified: '', conflict: false, isDir: false }; });
      sandbox.on(store, 'delete', () => { return { deleted: true, modified: '', conflict: false }; });
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

  const put = async (path, body) => {
    const ret = await req.put(path).type('text/plain')
      .set('Authorization', 'Bearer a_token,metadata=eyJvZ193cml0ZV9jYXBhY2l0eSI6InlVcy91Z2VBRU43d2dYeVRrN1owTHc9PSJ9').send(body);
    return ret;
  };

  const del = (path) => {
    return req.delete(path).buffer(true)
      .set('Authorization', 'Bearer a_token,metadata=eyJvZ193cml0ZV9jYXBhY2l0eSI6InlVcy91Z2VBRU43d2dYeVRrN1owTHc9PSJ9');
  };

  it('token is amended with storage allowance metadata', async () => {
    const request = {
      headers: [],
      body: '',
      url: ''
    };

    const dut = new StorageAllowance(null, request, null, null, opts);
    let calledRender = false;
    dut.getAvailable = () => [500, 500];
    dut.renderHTML = () => { calledRender = true; };

    const token = qs.stringify({ access_token: 'a_token' });
    const candidateResponse = {
      headers: {
        Location: `foo#${token}`
      }
    };

    dut.updateTokenOrWarn(candidateResponse);

    expect(calledRender).to.eql(false);
    expect(decodeURIComponent(candidateResponse.headers.Location)).to.contain('metadata=');
  });

  it('allows PUT through when storage request within limit', async () => {
    const server = new Armadietto(opts); /* no middleware stack setup for this test */
    await server.boot();

    let newConsumed = 0;
    sandbox.on(StorageAllowance.consumptionLimiterRedis, 'get', () => { return { consumedPoints: 500 }; });
    sandbox.on(StorageAllowance.consumptionLimiterRedis, 'set', (key, newValue) => { newConsumed = newValue; });
    const ret = await put('/storage/zebcoe@local.dev/data', 'a'.repeat(750));

    expect(ret.statusCode).to.eql(200);
    expect(newConsumed).to.be.eql(750);
    await server.stop();
  });

  it('507s when PUT storage request beyond limit', async () => {
    const server = new Armadietto(opts); /* no middleware stack setup for this test */
    await server.boot();

    let newConsumed = 0;
    sandbox.on(StorageAllowance.consumptionLimiterRedis, 'get', () => { return { consumedPoints: 500 }; });
    sandbox.on(StorageAllowance.consumptionLimiterRedis, 'set', (key, newValue) => { newConsumed = newValue; });
    const ret = await put('/storage/zebcoe@local.dev/data', 'a'.repeat(1200));

    expect(ret.statusCode).to.eql(507);
    expect(newConsumed).to.be.eql(1200);
    await server.stop();
  });

  it('allows DELETE through when storage request past limit', async () => {
    const server = new Armadietto(opts); /* no middleware stack setup for this test */
    await server.boot();

    sandbox.on(StorageAllowance.consumptionLimiterRedis, 'get', () => { return { consumedPoints: 2000 }; });
    sandbox.on(StorageAllowance.consumptionLimiterRedis, 'set');
    const ret = await del('/storage/zebcoe@local.dev/data');

    expect(ret.statusCode).to.eql(200);
    expect(store.delete).to.have.been.called.exactly(1);
    await server.stop();
  });

  it('allows GET through when storage request past limit, without touching cache', async () => {
    const server = new Armadietto(opts); /* no middleware stack setup for this test */
    await server.boot();

    sandbox.on(StorageAllowance.consumptionLimiterRedis, 'get');
    sandbox.on(StorageAllowance.consumptionLimiterRedis, 'set');
    const ret = await get('/storage/zebcoe@local.dev/data');

    expect(ret.statusCode).to.eql(304);
    expect(store.get).to.have.been.called.exactly(1);
    expect(StorageAllowance.consumptionLimiterRedis.get).to.have.been.called.exactly(0);
    expect(StorageAllowance.consumptionLimiterRedis.set).to.have.been.called.exactly(0);
    await server.stop();
  });
});
