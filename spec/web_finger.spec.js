/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */
const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);

/** trims all whitespaces to be a single space (' ') for text compares */
const trim = (what) => what.replace(/\s+/gm, ' ').trim();

// arrow functions are incompatible with sharing tests
exports.shouldImplementWebFinger = function () {
  it('returns webfinger data as JRD+JSON', async function () {
    const host = `http://127.0.0.1:${this.port}`;
    const res = await chai.request(this.server).keepOpen().get('/.well-known/webfinger');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', /^application\/jrd\+json/);
    expect(res.body).to.be.deep.equal({
      links: [{ rel: 'lrdd', template: host + '/webfinger/jrd?resource={uri}' }]
    });
  });

  it('returns host metadata as JSON', async function () {
    const host = `http://127.0.0.1:${this.port}`;
    const res = await chai.request(this.server).keepOpen().get('/.well-known/host-meta.json');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.be.json;
    expect(res.body).to.be.deep.equal({
      links: [{ rel: 'lrdd', template: host + '/webfinger/jrd?resource={uri}' }]
    });
  });

  it('returns host metadata as XML', async function () {
    const host = `http://127.0.0.1:${this.port}`;
    const res = await chai.request(this.server).keepOpen().get('/.well-known/host-meta').buffer(true);
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', /^application\/xrd\+xml/);
    expect(trim(res.text)).to.be.equal(trim(`
      <?xml version="1.0" encoding="UTF-8"?>
      <XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
        <Link rel="lrdd" type="application/xrd+xml" template="${host}/webfinger/xrd?resource={uri}" />
      </XRD>`));
  });

  it('returns account metadata as JSON', async function () {
    const host = `http://127.0.0.1:${this.port}`;
    const res = await chai.request(this.server).keepOpen().get('/webfinger/jrd?resource=acct:zebcoe@locog');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', /application\/jrd\+json/);
    expect(res.body).to.have.deep.equal({
      links: [{
        rel: 'remoteStorage',
        api: 'simple',
        auth: host + '/oauth/zebcoe',
        template: host + '/storage/zebcoe/{category}'
      }]
    });
  });

  it('returns account metadata as XML', async function () {
    const host = `http://127.0.0.1:${this.port}`;
    const res = await chai.request(this.server).keepOpen().get('/webfinger/xrd?resource=acct:zebcoe@locog').buffer();
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', /application\/xrd\+xml/);
    expect(trim(res.text)).to.be.equal(trim(`
      <?xml version="1.0" encoding="UTF-8"?>
      <XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
        <Link rel="remoteStorage" api="simple" auth="${host}/oauth/zebcoe" template="${host}/storage/zebcoe/{category}" />
      </XRD>`));
  });

  it('returns resource metadata as JSON', async function () {
    const host = `http://127.0.0.1:${this.port}`;
    const res = await chai.request(this.server).keepOpen().get('/.well-known/host-meta.json?resource=acct:zebcoe@locog');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.be.json;
    expect(res.body.links[0].href).to.equal(host + '/storage/zebcoe');
    expect(res.body.links[0].rel).to.equal('remotestorage');
    expect(res.body.links[0].type).to.match(/draft-dejong-remotestorage-\d\d/);
    expect(res.body.links[0].properties['auth-method']).to.equal('http://tools.ietf.org/html/rfc6749#section-4.2');
    expect(res.body.links[0].properties['auth-endpoint']).to.equal(host + '/oauth/zebcoe');
    expect(res.body.links[0].properties['http://remotestorage.io/spec/version']).to.match(/draft-dejong-remotestorage-\d\d/);
    expect(res.body.links[0].properties['http://tools.ietf.org/html/rfc6749#section-4.2']).to.equal(host + '/oauth/zebcoe');
    expect(res.body.links[0].properties['http://tools.ietf.org/html/rfc6750#section-2.3']).to.equal(true);
    expect(res.body.links).to.have.length(1);
  });

  it('returns resource metadata as XML', async function () {
    const res = await chai.request(this.server).keepOpen().get('/.well-known/host-meta?resource=acct:zebcoe@locog').buffer(true);
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Content-Type', /^application\/xrd\+xml/);
    expect(trim(res.text)).to.match(new RegExp(trim(`
<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
    <Link href="http://127.0.0.1:${this.port}/storage/zebcoe" rel="remotestorage" type="draft-dejong-remotestorage-\\d\\d">
        <Property type="auth-method">http://tools.ietf.org/html/rfc6749#section-4.2</Property>
        <Property type="auth-endpoint">http://127.0.0.1:${this.port}/oauth/zebcoe</Property>
        <Property type="http://remotestorage.io/spec/version">draft-dejong-remotestorage-\\d\\d</Property>
        <Property type="http://tools.ietf.org/html/rfc6750#section-2.3">true</Property>
        <Property type="http://tools.ietf.org/html/rfc6749#section-4.2">http://127.0.0.1:${this.port}/oauth/zebcoe</Property>
    </Link>
</XRD>
`)));
  });
};
