/* eslint-env mocha, chai, node */
const chai = require('chai');
const chaiHttp = require('chai-http');
const spies = require('chai-spies');
const expect = chai.expect;

const Armadietto = require('../../lib/armadietto');

chai.use(chaiHttp);
chai.use(spies);

const req = chai.request('http://127.0.0.1:4567');
const get = async (path, params) => {
  const ret = await req.get(path)
    .redirects(0)
    .query(params)
    .send();
  return ret;
};

const post = async (path, params) => {
  const ret = await req.post(path)
    .redirects(0)
    .type('form')
    .send(params);
  return ret;
};

const store = {
  authorize (clientId, username, permissions) {
    return 'a_token';
  },
  authenticate (params) {
  }
};

const sandbox = chai.spy.sandbox();
describe('OAuth', async () => {
  before((done) => {
    (async () => {
      this._server = new Armadietto({
        store,
        http: { port: 4567 },
        logging: { log_dir: './test-log', stdout: [], log_files: ['error'] }
      });
      await this._server.boot();
      done();
    })();
  });

  after((done) => {
    (async () => {
      await this._server.stop();
      done();
    })();
  });

  beforeEach(() => {
    this.auth_params = {
      username: 'zebcoe',
      password: 'locog',
      client_id: 'the_client_id',
      redirect_uri: 'http://example.com/cb',
      response_type: 'token',
      scope: 'the_scope',
      state: 'the_state'
    };

    sandbox.on(store, ['authorize', 'authenticate']);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('with invalid client input', () => {
    beforeEach(() => {
      delete this.auth_params.state;
    });

    it('returns an error if redirect_uri is missing', async () => {
      delete this.auth_params.redirect_uri;
      const res = await get('/oauth/me', this.auth_params);
      expect(res).to.have.status(400);
      expect(res.text).to.have.been.equal('error=invalid_request&error_description=Required%20parameter%20%22redirect_uri%22%20is%20missing');
    });

    it('returns an error if client_id is missing', async () => {
      delete this.auth_params.client_id;
      const res = await get('/oauth/me', this.auth_params);
      expect(res).to.redirectTo('http://example.com/cb#error=invalid_request&error_description=Required%20parameter%20%22client_id%22%20is%20missing');
    });

    it('returns an error if response_type is missing', async () => {
      delete this.auth_params.response_type;
      const res = await get('/oauth/me', this.auth_params);
      expect(res).to.redirectTo('http://example.com/cb#error=invalid_request&error_description=Required%20parameter%20%22response_type%22%20is%20missing');
    });

    it('returns an error if response_type is not recognized', async () => {
      this.auth_params.response_type = 'wrong';
      const res = await get('/oauth/me', this.auth_params);
      expect(res).to.redirectTo('http://example.com/cb#error=unsupported_response_type&error_description=Response%20type%20%22wrong%22%20is%20not%20supported');
    });

    it('returns an error if scope is missing', async () => {
      delete this.auth_params.scope;
      const res = await get('/oauth/me', this.auth_params);
      expect(res).to.redirectTo('http://example.com/cb#error=invalid_scope&error_description=Parameter%20%22scope%22%20is%20invalid');
    });

    it('returns an error if username is missing', async () => {
      delete this.auth_params.username;
      const res = await post('/oauth', this.auth_params);
      expect(res).to.have.status(400);
    });
  });

  describe('with valid login credentials', async () => {
    describe('without explicit read/write permissions', async () => {
      it('authorizes the client to read and write', async () => {
        await post('/oauth', this.auth_params);
        expect(store.authorize).to.be.called.with('the_client_id', 'zebcoe', { the_scope: ['r', 'w'] });
      });
    });

    describe('with explicit read permission', async () => {
      it('authorizes the client to read', async () => {
        this.auth_params.scope = 'the_scope:r';
        await post('/oauth', this.auth_params);
        expect(store.authorize).to.be.called.with('the_client_id', 'zebcoe', { the_scope: ['r'] });
      });
    });

    describe('with explicit read/write permission', async () => {
      it('authorizes the client to read and write', async () => {
        this.auth_params.scope = 'the_scope:rw';
        await post('/oauth', this.auth_params);
        expect(store.authorize).to.be.called.with('the_client_id', 'zebcoe', { the_scope: ['r', 'w'] });
      });
    });

    it('redirects with an access token', async () => {
      const res = await post('/oauth', this.auth_params);
      expect(res).to.redirectTo('http://example.com/cb#access_token=a_token&token_type=bearer&state=the_state');
    });
  });

  describe('with invalid login credentials', async () => {
    it('does not authorize the client', async () => {
      store.authenticate = (params) => {
        throw new Error();
      };
      await post('/oauth', this.auth_params);
      expect(store.authorize).to.be.called.exactly(0);
    });

    it('returns a 401 response with the login form', async () => {
      store.authenticate = (params) => {
        throw new Error();
      };
      const res = await post('/oauth', this.auth_params);
      expect(res).to.have.status(401);
      expect(res).to.have.header('Content-Type', 'text/html; charset=utf8');
      expect(res).to.have.header('Content-Security-Policy', /sandbox.*default-src 'self'/);
      expect(res).to.have.header('Referrer-Policy', 'no-referrer');
      expect(res).to.have.header('X-Content-Type-Options', 'nosniff');
      expect(res.text).to.contain('application <em>the_client_id</em> hosted');
    });
  });
});
