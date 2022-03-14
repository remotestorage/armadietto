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
        '/data': ['r'],
      };
    }
  }
};

var callOrder = [];

// Various middleware classes matching the middleware contracat are below.
//
// The middleware contract:
//
//  /**
//   * Part of middleware mechanism, every middleware needs this static method adhering to this contract.
//   * 
//   * @param {*} options - to check for availability of this extension
//   * @reutrns {bool} whether this class is enabled if `options` indicate as much
//   */
//   static isEnabled(options) {..}
//
//  /**
//   * Part of middleware mechanism, every middleware needs to extent the `Controller` class and have a constructor adhering to this contract.
//   * 
//   * @param {*} server - instance of the overall server
//   * @param {*} request - the request this instance is for
//   * @param {*} response - the response this instance is for
//   * @param {*} next - the next middleware to call to continue processing during handling
//   * @param {*} options - the options object
//   */ 
//  constructor (server, request, response, next, options) {...}
//
//  /** 
//   * Part of middleware mechanism, every middleware is called at most once per instance of this class to handle its business.
//   * Actual request handler called from other middleware.  Act on `request` from constructor and set state of `response`.
//   * Make sure to call `next` when ready call deeper into middleware stack, before handling responses in your middleware.
//   */
//  handle = async () => {...}

class DisabledMiddlewareA {
   static isEnabled(options) { return false; }
  constructor (server, request, response, next, options) { }
  handle = async () => { callOrder.push('DisabledMiddlewareA') }  
}

class MiddlewareB {
  static isEnabled(options) { return true; }
  constructor (server, request, response, next, options) { 
    this._next = next; /* save off the next injected middleware or DISPATCH */
  }
  handle = async () => { 
    callOrder.push('MiddlewareBPre'); 
    await this._next(); /* very important, call `next()` */ 
    callOrder.push('MiddlewareBPost'); 
  }  
}

class MiddlewareC {
  static isEnabled(options) { return true; }
  constructor (server, request, response, next, options) { 
    this._next = next; /* save off the next injected middleware or DISPATCH */
  }
  handle = async () => { 
    callOrder.push('MiddlewareCPre'); 
    await this._next(); /* very important, call `next()` */ 
    callOrder.push('MiddlewareCPost'); 
  }  
}

class AbortMiddlewareD {
  static isEnabled(options) { return true; }
  constructor (server, request, response, next, options) { 
    this._next = next; /* save off the next injected middleware or DISPATCH */
  }
  handle = async () => { 
    callOrder.push('AbortMiddlewareDPre'); 
  }  
}

/**
 * Below is the `opts` options object passed to Armadietto to intialize and dependency inject.  E.g. we 
 * dependency inject `store` below.
 * 
 * Middleware is also dependency injected in the same fasion as the `middleware` array.
 * 
 * You can see this done in each test below, where we depednendy inject an array of somecombination of the
 * above sample classes.
 */
const opts = {
  store,
  http: { port: 4567 },
  logging: { log_dir: './test-log', stdout: [], log_files: ['error'] }
};

const sandbox = chai.spy.sandbox();
const modifiedTimestamp = Date.UTC(2012, 1, 25, 13, 37).toString();
describe('Middleware', () => {
  beforeEach((done) => {
    (async () => {
      callOrder = [];
      sandbox.on(store, 'get', () => callOrder.push('DISPATCH'));
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

  it('not present, just vanilla dispatch, dispatch being main Armadietto handler.', async () => {
    const server = new Armadietto(opts); /* no middleware stack setup for this test */
    await server.boot();

    await get('/storage/zebcoe@local.dev/data');    
    expect(callOrder).to.eql(['DISPATCH']);

    await server.stop();
  });

  it(`has two extensions and they're called in-order defined:  B then C then dispatch, dispatch being main Armadietto handler.`, async () => {
    const server = new Armadietto({
      ...opts, 
      middleware: [MiddlewareB, MiddlewareC] /* this is the middleware stack definition for this test */
    });
    await server.boot();

    await get('/storage/zebcoe@local.dev/data');    
    expect(callOrder).to.eql(['MiddlewareBPre', 'MiddlewareCPre', 'DISPATCH', 'MiddlewareCPost', 'MiddlewareBPost']);

    await server.stop();
  });

  it(`has three extensions but one is disabled defined:  B, A is disabled, then C, then dispatch, dispatch being main Armadietto handler.`, async () => {
    const server = new Armadietto({
      ...opts, 
      middleware: [MiddlewareB, DisabledMiddlewareA, MiddlewareC] /* this is the middleware stack definition for this test */
    });
    await server.boot();

    await get('/storage/zebcoe@local.dev/data');    
    expect(callOrder).to.eql(['MiddlewareBPre', 'MiddlewareCPre', 'DISPATCH', 'MiddlewareCPost', 'MiddlewareBPost']);

    await server.stop();
  });

  it(`short-circuits calls and doesn't call rest of middleware when middleware fully handled request.`, async () => {
    const server = new Armadietto({
      ...opts, 
      middleware: [MiddlewareB, AbortMiddlewareD, MiddlewareC] /* this is the middleware stack definition for this test */
    });
    await server.boot();

    await get('/storage/zebcoe@local.dev/data');    
    expect(callOrder).to.eql(['MiddlewareBPre', 'AbortMiddlewareDPre', 'MiddlewareBPost']);

    await server.stop();
  });

});
