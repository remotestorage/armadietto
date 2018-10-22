/* eslint-env mocha, chai, node */
const chai = require('chai');
const chaiHttp = require('chai-http');
const spies = require('chai-spies');
const expect = chai.expect;

const Armadietto = require('../../lib/armadietto');

chai.use(chaiHttp);
chai.use(spies);
let store = {};
const host = 'http://localhost:4569';
const req = chai.request(host);

const get = async (path) => {
  const ret = await req.get(path).buffer(true);
  return ret;
};

describe('WebFinger', () => {
  before(async () => {
    this._server = new Armadietto({ store, http: { port: 4569 } });
    await this._server.boot();
  });

  after(async () => { await this._server.stop(); });

  it('returns webfinger data as JRD+JSON', async () => {
    const res = await get('/.well-known/webfinger');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', 'application/jrd+json');
    expect(res.body).to.be.deep.equal({
      'links': [
        {
          'rel': 'lrdd',
          'template': host + '/webfinger/jrd?resource={uri}'
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
      'links': [
        {
          'rel': 'lrdd',
          'template': host + '/webfinger/jrd?resource={uri}'
        }
      ]
    });
  });

  it('returns host metadata as XML', async () => {
    const res = await get('/.well-known/host-meta');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', 'application/xrd+xml');
    expect(res.text).to.be.equal(`<?xml version="1.0" encoding="UTF-8"?>
<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
  <Link rel="lrdd"
        type="application/xrd+xml"
        template="${host}/webfinger/xrd?resource={uri}" />\n</XRD>\n`);
  });

  it('returns account metadata as JSON', async () => {
    const res = await get('/webfinger/jrd?resource=acct:zebcoe@locog');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', 'application/jrd+json');
    expect(res.body).to.have.deep.equal({
      'links': [
        {
          'rel': 'remoteStorage',
          'api': 'simple',
          'auth': host + '/oauth/zebcoe',
          'template': host + '/storage/zebcoe/{category}'
        }
      ]
    });
  });

  it('returns account metadata as XML', async () => {
    const res = await get('/webfinger/xrd?resource=acct:zebcoe@locog');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', 'application/xrd+xml');
    expect(res.text).to.be.equal(`<?xml version="1.0" encoding="UTF-8"?>
<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
  <Link rel="remoteStorage"
        api="simple"
        auth="${host}/oauth/zebcoe"
        template="${host}/storage/zebcoe/{category}" />\n</XRD>\n`);
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
      'links': [
        {
          'href': host + '/storage/zebcoe',
          'rel': 'remotestorage',
          'type': 'draft-dejong-remotestorage-01',
          'properties': {
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
    //     check_body( '<?xml version="1.0" encoding="UTF-8"?>\n\
    // <XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">\n\
    //   <Link href="http://localhost:4567/storage/zebcoe"\n\
    //         rel="remotestorage"\n\
    //         type="draft-dejong-remotestorage-01">\n\
    //     <Property type="auth-method">http://tools.ietf.org/html/rfc6749#section-4.2</Property>\n\
    //     <Property type="auth-endpoint">http://localhost:4567/oauth/zebcoe</Property>\n\
    //     <Property type="http://remotestorage.io/spec/version">draft-dejong-remotestorage-01</Property>\n\
    //     <Property type="http://tools.ietf.org/html/rfc6750#section-2.3">true</Property>\n\
    //     <Property type="http://tools.ietf.org/html/rfc6749#section-4.2">http://localhost:4567/oauth/zebcoe</Property>\n\
    //   </Link>\n\
    // </XRD>' )
  });
});
