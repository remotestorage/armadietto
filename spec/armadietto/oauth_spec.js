/* eslint-env mocha, chai, node */
const chai = require('chai');
const chaiHttp = require('chai-http');
const spies = require('chai-spies');
const expect = chai.expect;

const Armadietto = require('../../lib/armadietto');

chai.use(chaiHttp);
chai.use(spies);

before(() => {
  this._server = new Armadietto({ store, http: { port: 4567 } });
  this._server.boot();
});

after(() => { this._server.stop(); });

const req = chai.request('http://localhost:4567');
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
    .send(params);
  return ret;
};

let store = {};

describe('OAuth', async () => {
  describe('with invalid client input', () => {
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
    // before(async () => {
    //   expect(store, 'authenticate')
    //     .given(objectIncluding({username: 'zebcoe', password: 'locog'}))
    //     .yielding([null]);
    // });

    describe('without explicit read/write permissions', async () => {
      before(() => { this.auth_params.scope = 'the_scope'; });

      it('authorizes the client to read and write', async () => {
        expect(store, 'authorize').given('the_client_id', 'zebcoe', {the_scope: ['r', 'w']}).yielding([null, 'a_token']);
        // post('/oauth', this.auth_params);
      });
    });

    describe('with explicit read permission', async () => {
      before(() => { this.auth_params.scope = 'the_scope:r'; });

      it('authorizes the client to read', async () => {
        expect(store, 'authorize').given('the_client_id', 'zebcoe', {the_scope: ['r']}).yielding([null, 'a_token']);
        // post('/oauth', this.auth_params);
      });
    });

    describe('with explicit read/write permission', async () => {
      before(function () { this.auth_params.scope = 'the_scope:rw'; });

      it('authorizes the client to read and write', async () => {
        expect(store, 'authorize').given('the_client_id', 'zebcoe', {the_scope: ['r', 'w']}).yielding([null, 'a_token']);
        // post('/oauth', this.auth_params);
      });
    });

    it('redirects with an access token', async () => {
      // stub(store, 'authorize').yields([null, 'a_token']);
      // post('/oauth', this.auth_params);
      // check_redirect('http://example.com/cb#access_token=a_token&token_type=bearer&state=the_state');
    });
  });

  describe('with invalid login credentials', async () => {
    before(async () => {
      // expect(store, 'authenticate')
      //   .given(objectIncluding({username: 'zebcoe', password: 'locog'}))
      //   .yielding([new Error()]);
    });

    it('does not authorize the client', async () => {
      expect(store, 'authorize').exactly(0);
      // post('/oauth', this.auth_params);
    });

    it('returns a 401 response with the login form', async () => {
      // post('/oauth', this.auth_params);
      // check_status(401);
      // check_header('Content-Type', 'text/html');
      // check_body(/application <em>the_client_id<\/em> hosted/);
    });
  });
});
