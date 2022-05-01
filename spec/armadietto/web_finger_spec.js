/* eslint-env mocha, chai, node */
const chai = require('chai');
const chaiHttp = require('chai-http');
const spies = require('chai-spies');
const expect = chai.expect;

const Armadietto = require('../../lib/armadietto');

chai.use(chaiHttp);
chai.use(spies);
const store = {};
const port = '4569';
const host = `http://127.0.0.1:${port}`;
const req = chai.request(host);

const get = async (path) => {
  const ret = await req.get(path).buffer(true);
  return ret;
};

// trim all whitespaces to be a single space (' ') for text compares
const trim = (what) => what.replace(/\s+/gm, ' ').trim();

describe('WebFinger', () => {
  before((done) => {
    (async () => {
      this._server = new Armadietto({
        store,
        http: { port },
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

  it('returns webfinger data as JRD+JSON', async () => {
    const res = await get('/.well-known/webfinger');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', 'application/jrd+json');
    expect(res.body).to.be.deep.equal({
      links: [
        {
          rel: 'lrdd',
          template: host + '/webfinger/jrd?resource={uri}'
        }
      ]
    });
  });

  it('returns host metadata as JSON', async () => {
    const res = await get('/.well-known/host-meta.json');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', 'application/json');
    expect(res.body).to.be.deep.equal({
      links: [
        {
          rel: 'lrdd',
          template: host + '/webfinger/jrd?resource={uri}'
        }
      ]
    });
  });

  it('returns host metadata as XML', async () => {
    const res = await get('/.well-known/host-meta');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', 'application/xrd+xml');
    expect(trim(res.text)).to.be.equal(trim(`
      <?xml version="1.0" encoding="UTF-8"?>
      <XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
        <Link rel="lrdd" type="application/xrd+xml" template="${host}/webfinger/xrd?resource={uri}" />
      </XRD>`));
  });

  it('returns account metadata as JSON', async () => {
    const res = await get('/webfinger/jrd?resource=acct:zebcoe@locog');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', 'application/jrd+json');
    expect(res.body).to.have.deep.equal({
      links: [
        {
          rel: 'remoteStorage',
          api: 'simple',
          auth: host + '/oauth/zebcoe',
          template: host + '/storage/zebcoe/{category}'
        }
      ]
    });
  });

  it('returns account metadata as XML', async () => {
    const res = await get('/webfinger/xrd?resource=acct:zebcoe@locog');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', 'application/xrd+xml');
    expect(trim(res.text)).to.be.equal(trim(`
      <?xml version="1.0" encoding="UTF-8"?>
      <XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
        <Link rel="remoteStorage" api="simple" auth="${host}/oauth/zebcoe" template="${host}/storage/zebcoe/{category}" />
      </XRD>`));
  });

  it('returns resource metadata as JSON', async () => {
    const res = await get('/.well-known/host-meta.json?resource=acct:zebcoe@locog');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', 'application/json');
    //     check_status( 200 )
    //     check_header( "Access-Control-Allow-Origin", "*" )
    //     check_header( "Content-Type", "application/json" )
    expect(res.body).to.have.deep.equal({
      links: [
        {
          href: host + '/storage/zebcoe',
          rel: 'remotestorage',
          type: 'draft-dejong-remotestorage-01',
          properties: {
            'auth-method': 'http://tools.ietf.org/html/rfc6749#section-4.2',
            'auth-endpoint': host + '/oauth/zebcoe',
            'http://remotestorage.io/spec/version': 'draft-dejong-remotestorage-01',
            'http://tools.ietf.org/html/rfc6749#section-4.2': host + '/oauth/zebcoe',
            'http://tools.ietf.org/html/rfc6750#section-2.3': true
          }
        }
      ]
    });
  });

  it('returns resource metadata as XML', async () => {
    const res = await get('/.well-known/host-meta?resource=acct:zebcoe@locog');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', 'application/xrd+xml');
    expect(trim(res.text)).to.be.equal(trim(`
      <?xml version="1.0" encoding="UTF-8"?>
      <XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
        <Link href="http://127.0.0.1:${port}/storage/zebcoe" rel="remotestorage" type="draft-dejong-remotestorage-01">
          <Property type="auth-method">http://tools.ietf.org/html/rfc6749#section-4.2</Property>
          <Property type="auth-endpoint">http://127.0.0.1:${port}/oauth/zebcoe</Property>
          <Property type="http://remotestorage.io/spec/version">draft-dejong-remotestorage-01</Property>
          <Property type="http://tools.ietf.org/html/rfc6750#section-2.3">true</Property>
          <Property type="http://tools.ietf.org/html/rfc6749#section-4.2">http://127.0.0.1:${port}/oauth/zebcoe</Property>
        </Link>
      </XRD>`));
  });
});
