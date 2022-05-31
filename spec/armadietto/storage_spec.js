/* eslint-env mocha, chai, node */
const chai = require('chai');
const chaiHttp = require('chai-http');
const spies = require('chai-spies');
const expect = chai.expect;
const chaiAsPromised = require('chai-as-promised');
const Armadietto = require('../../lib/armadietto');
const { get, subject, def } = require('bdd-lazy-var');

chai.use(chaiHttp);
chai.use(chaiAsPromised);
chai.use(spies);

// const req = chai.request('http://127.0.0.1:4568');
const store = {
  get (username, path) {
    return { item: null, versionMatch: true };
  },
  permissions (user, token) {
    if (user === 'boris' && token === 'a_token') return false;
    if (user === 'zebcoe' && token === 'a_token') {
      return {
        '/locog/': ['r', 'w'],
        '/books/': ['r'],
        '/statuses/': ['w'],
        '/deep/dir/': ['r', 'w']
      };
    }
    if (user === 'zebcoe' && token === 'root_token') return { '/': ['r', 'r'] };
    if (user === 'zebcoe' && token === 'bad_token') return false;
  }
};

const sandbox = chai.spy.sandbox();
const modifiedTimestamp = Date.UTC(2012, 1, 25, 13, 37).toString();
describe('Storage', () => {
  before((done) => {
    (async () => {
      this._server = new Armadietto({
        store,
        http: { port: 4567 },
        logging: { log_dir: './test-log', stdout: [], log_files: ['warning', 'info'] }
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

  const req = chai.request('http://127.0.0.1:4567');
  subject('req', () => req.get(get.path));

  describe('when the client uses path traversal in the path', () => {
    def('path', '/storage/zebcoe/locog/../seats/');
    it('returns a 400', () => expect(get.req).to.eventually.have.status(400)
      .to.eventually.have.header('Access-Control-Allow-Origin', '*'));
  });

  describe('when the client uses invalid chars in the path', () => {
    def('path', '/storage/zebcoe/locog/$eats');
    it('returns a 400', () => expect(get.req)
      .to.eventually.have.status(400)
      .to.eventually.have.header('Access-Control-Allow-Origin', '*'));
  });

  describe('when the client uses a zero-length path', () => {
    def('path', '/storage/zebcoe');
    it('returns a 400', () => expect(get.req)
      .to.eventually.have.status(400)
      .to.eventually.have.header('Access-Control-Allow-Origin', '*'));
  });

  describe('OPTIONS', () => {
    it('returns access control headers', async () => {
      const res = await req.options('/storage/zebcoe/locog/seats').set('Origin', 'https://example.com').buffer(true);
      expect(res.statusCode).to.be.oneOf([200, 204]);
      expect(res).to.have.header('Access-Control-Allow-Origin', 'https://example.com');
      expect(res).to.have.header('Vary', 'Origin');
      expect(res).to.have.header('Access-Control-Allow-Headers', 'Authorization, Content-Length, Content-Type, If-Match, If-None-Match, Origin, X-Requested-With');
      expect(res).to.have.header('Access-Control-Allow-Methods', 'OPTIONS, GET, HEAD, PUT, DELETE');
      expect(res).to.have.header('Access-Control-Expose-Headers', 'Content-Length, Content-Type, ETag');
      expect(res).to.have.header('Cache-Control', 'no-cache');
      expect(res).to.have.header('Access-Control-Max-Age');
      expect(parseInt(res.header['access-control-max-age'])).to.be.greaterThan(10);
      expect(res.text).to.be.equal('');
    });
  });

  describe('GET', () => {
    describe('when a valid access token is used', () => {
      afterEach(() => {
        sandbox.restore();
      });

      beforeEach(() => {
        sandbox.on(store, ['get']);
      });

      const get = async (path) => {
        const ret = await req.get(path)
          .set('Authorization', 'Bearer a_token').send();
        return ret;
      };

      it('asks the store for the item', async () => {
        await get('/storage/zebcoe@local.dev/locog/seats');
        expect(store.get).to.have.been.called.with('zebcoe', '/locog/seats');
      });

      it('asks the store for items containing dots', async () => {
        await get('/storage/zebcoe@local.dev/locog/seats.gif');
        expect(store.get).to.have.been.called.with('zebcoe', '/locog/seats.gif');
      });

      it('asks the store for a deep item', async () => {
        await get('/storage/zebcoe@local.dev/deep/dir/value');
        expect(store.get).to.have.been.called.with('zebcoe', '/deep/dir/value');
      });

      it('passes the path literally to the store', async () => {
        await get('/storage/zebcoe/locog/a%2Fpath');
        expect(store.get).to.have.been.called.with('zebcoe', '/locog/a%2Fpath');
      });

      it('ask the store for a directory listing', async () => {
        await get('/storage/zebcoe/locog/');
        expect(store.get).to.have.been.called.with('zebcoe', '/locog/');
      });

      it('ask the store for a deep directory listing', async () => {
        await get('/storage/zebcoe/deep/dir/');
        expect(store.get).to.have.been.called.with('zebcoe', '/deep/dir/');
      });

      it('ask the store for a root listing with unauthorized token', async () => {
        await get('/storage/zebcoe/');
        expect(store.get).to.have.been.called.exactly(0);
      });

      it('ask the store for a root listing', async () => {
        await req.get('/storage/zebcoe/')
          .set('Authorization', 'Bearer root_token').send();
        expect(store.get).to.have.been.called.with('zebcoe', '/');
      });

      it('ask the store for an item conditionally based on If-None-Match', async () => {
        await req.get('/storage/zebcoe/locog/seats')
          .set('Authorization', 'Bearer a_token')
          .set('If-None-Match', `"${modifiedTimestamp}"`).send();
        expect(store.get).to.have.been.called.with('zebcoe', '/locog/seats', `"${modifiedTimestamp}"`);
      });

      it('do not ask the store for an item in an unauthorized directory', async () => {
        await get('/storage/zebcoe/jsconf/tickets');
        expect(store.get).to.have.been.called.exactly(0);
      });

      it('do not ask the store for an item in an too-broad directory', async () => {
        await get('/storage/zebcoe/deep/nothing');
        expect(store.get).to.have.been.called.exactly(0);
      });

      it('do not ask the store for an unauthorized directory', async () => {
        await get('/storage/zebcoe/deep/');
        expect(store.get).to.have.been.called.exactly(0);
      });

      it('do not ask the store for an item in a read-unauthorized directory', async () => {
        await get('/storage/zebcoe/statues/first');
        expect(store.get).to.have.been.called.exactly(0);
      });

      it('do not ask the store for an item of another user', async () => {
        await get('/storage/boris/locog/seats');
        expect(store.get).to.have.been.called.exactly(0);
      });
    });

    describe('when an invalid access token is used', () => {
      afterEach(() => {
        sandbox.restore();
      });

      beforeEach(() => {
        sandbox.on(store, ['get']);
      });

      const get = async (path) => {
        const ret = await req.get(path).buffer(true)
          .set('Authorization', 'Bearer bad_token').send();
        return ret;
      };

      it('does not ask the store for the item', async () => {
        await get('/storage/zebcoe/locog/seats');
        expect(store.get).to.have.been.called.exactly(0);
      });

      it('asks the store for a public item', async () => {
        await get('/storage/zebcoe/public/locog/seats');
        expect(store.get).to.have.been.called.with('zebcoe', '/public/locog/seats');
      });

      it('does not ask the store for a public directory', async () => {
        await get('/storage/zebcoe/public/locog/seats/');
        expect(store.get).to.have.been.called.exactly(0);
      });

      it('returns an OAuth error', async () => {
        const res = await get('/storage/zebcoe/locog/seats');
        expect(res).to.have.status(401);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res).to.have.header('Cache-Control', 'no-cache');
        expect(res).to.have.header('WWW-Authenticate', 'Bearer realm="127.0.0.1:4567" error="invalid_token"');
      });
    });

    const item = {
      'Content-Type': 'custom/type',
      ETag: '1330177020000',
      'Last-Modified': 'Mon, 25 May 2015 05:25:55 GMT',
      value: 'a value'
    };

    const get = async (path) => {
      const ret = await req.get(path).buffer(true)
        .set('Authorization', 'Bearer a_token').send();
      return ret;
    };

    describe('when the store returns an item', () => {
      it('returns the value in the response', async () => {
        store.get = () => ({ item });
        const res = await get('/storage/zebcoe/locog/seats');
        expect(res).to.have.status(200);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res).to.have.header('Cache-Control', 'no-cache');
        expect(res).to.have.header('Content-Length', '7');
        expect(res).to.have.header('Content-Type', 'custom/type');
        expect(res).to.have.header('ETag', '"1330177020000"');
        expect(res).to.have.header('Last-Modified', 'Mon, 25 May 2015 05:25:55 GMT');
        expect(res.text).to.be.equal('a value');
      });

      it('returns a 304 for a failed conditional', async () => {
        store.get = () => ({ item, versionMatch: true });
        const res = await get('/storage/zebcoe/locog/seats');

        expect(res).to.have.status(304);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res).to.have.header('Cache-Control', 'no-cache');
        expect(res).to.have.header('ETag', '"1330177020000"');
        expect(res.text).to.be.equal('');
      });
    });

    describe('when the store returns a directory listing', () => {
      const folderData = {
        items: {
          bla: {
            ETag: '1234544444',
            'Content-Type': 'example/example',
            'Content-Length': 42,
            'Last-Modified': (new Date('2001-03-04T05:06:07+00:00')).toUTCString()
          },
          'bar/': { ETag: '12345888888' }
        },
        ETag: '12345888888'
      };
      before(() => {
        store.get = () => {
          return {
            item: folderData
          };
        };
      });

      it('returns the listing as JSON', async () => {
        const res = await get('/storage/zebcoe/locog/seats/');
        expect(res).to.have.status(200);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res).to.have.header('Cache-Control', 'no-cache');
        expect(res).to.have.header('ETag', '"12345888888"');
        expect(res).to.have.header('Content-Type', 'application/ld+json');
        expect(res).to.have.header('Content-Length');
        expect(parseInt(res.headers['content-length'])).to.be.greaterThan(50);
        expect(res.body['@context']).to.be.deep.equal('http://remotestorage.io/spec/folder-description');
        expect(res.body.items).to.be.deep.equal(folderData.items);
      });
    });

    describe('when the store returns an empty directory listing', () => {
      before(() => {
        store.get = () => {
          return { item: { items: {}, ETag: '12345888888' } };
        };
      });

      it('returns the listing as JSON', async () => {
        const res = await get('/storage/zebcoe/locog/seats/');
        expect(res).to.have.status(200);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res).to.have.header('Cache-Control', 'no-cache');
        expect(res).to.have.header('ETag', '"12345888888"');
        expect(res.body).to.be.deep.equal({
          '@context': 'http://remotestorage.io/spec/folder-description',
          items: {}
        });
      });
    });

    describe('when the item does not exist', () => {
      before(() => {
        store.get = () => ({ item: undefined });
      });

      it('returns an empty 404 response', async () => {
        const res = await get('/storage/zebcoe/locog/seats/');
        expect(res).to.have.status(404);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res.text).to.be.equal('');
      });
    });

    describe('when the store returns an error', () => {
      before(() => {
        store.get = () => { throw new Error('We did something wrong'); };
      });

      it('returns a 500 response with the error message', async () => {
        const res = await get('/storage/zebcoe/locog/seats/');
        expect(res).to.have.status(500);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res.text).to.be.equal('We did something wrong');
      });
    });

    describe('when the store returns a folder-document clash', () => {
      before(() => {
        store.get = () => { return { item: null, isClash: true }; };
      });

      it('returns a 409 response', async () => {
        const res = await get('/storage/zebcoe/locog/chairface/');
        expect(res).to.have.status(409);
        expect(res).to.have.header('Cache-Control', 'no-cache');
        expect(res).to.have.header('Content-Length');
        // expect(res.text).to.equal('A document was found where a folder was expected, or vice-versa.');
      });
    });
  });

  describe('HEAD', () => {
    const item = {
      'Content-Type': 'text/example',
      'Content-Length': 25,
      'Last-Modified': 'Wed, 17 Mar 2021 22:32:59 GMT',
      ETag: '1330177020329',
      value: 'a green and yellow basket'
    };

    const head = async (path) => {
      const ret = await req.head(path).buffer(true)
        .set('Authorization', 'Bearer a_token').send();
      return ret;
    };

    describe('when the store returns an item', () => {
      it('returns metadata in headers', async () => {
        store.get = () => ({ item });
        const res = await head('/storage/zebcoe/locog/thing');
        expect(res).to.have.status(200);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res).to.have.header('Cache-Control', 'no-cache');
        expect(res).to.have.header('ETag', '"1330177020329"');
        expect(res).to.have.header('Content-Type', 'text/example');
        expect(res).to.have.header('Content-Length', '25');
        expect(res).to.have.header('Last-Modified', 'Wed, 17 Mar 2021 22:32:59 GMT');
        expect(res.text).to.be.equal('');
      });

      it('returns a 304 for a failed conditional', async () => {
        store.get = () => ({ item, versionMatch: true });
        const res = await head('/storage/zebcoe/locog/thing');

        expect(res).to.have.status(304);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res).to.have.header('Cache-Control', 'no-cache');
        expect(res).to.have.header('ETag', '"1330177020329"');
        expect(res.text).to.be.equal('');
      });
    });

    const metadata = {
      ETag: 'K3KD98FKR9FK49',
      items: {
        foo: {
          ETag: '52KJLJLLK4K5JFK',
          'Content-Type': 'example/example',
          'Content-Length': 964,
          'Last-Modified': 'Sat, 2 Jun 2018 15:58:23 GMT'
        },
        'bar/': {
          ETag: '1337ABCD1337ABCD1337ABCD'
        }
      }
    };

    describe('when the store returns a directory', () => {
      it('returns metadata in headers', async () => {
        store.get = () => ({ item: metadata });
        const res = await head('/storage/zebcoe/locog/');
        expect(res).to.have.status(200);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res).to.have.header('Cache-Control', 'no-cache');
        expect(res).to.have.header('ETag', '"K3KD98FKR9FK49"');
        expect(res).to.have.header('Content-Type', 'application/ld+json');
        expect(res).to.have.header('Content-Length', '323');
        expect(res.text).to.be.equal('');
      });
    });
  });

  describe('PUT', () => {
    before(() => {
      sandbox.restore();
      store.put = () => ({ created: true });
    });

    const put = async (path, params) => {
      const ret = await req.put(path).buffer(true).type('text/plain')
        .set('Authorization', 'Bearer a_token').send(params);
      return ret;
    };

    afterEach(() => {
      sandbox.restore();
    });

    beforeEach(() => {
      sandbox.on(store, ['put']);
    });

    describe('when a valid access token is used', () => {
      it('tells the store to save the given value', async () => {
        await put('/storage/zebcoe/locog/seats', 'a value');
        expect(store.put).to.have.been.called.with('zebcoe', '/locog/seats',
          'text/plain', Buffer.from('a value'), null);
      });

      it('tells the store to save a public value', async () => {
        await put('/storage/zebcoe/public/locog/seats', 'a value');
        expect(store.put).to.have.been.called.with('zebcoe', '/public/locog/seats',
          'text/plain', Buffer.from('a value'), null);
      });

      it('tells the store to save a value conditionally based on If-None-Match', async () => {
        await req.put('/storage/zebcoe/locog/seats').buffer(true).type('text/plain')
          .set('Authorization', 'Bearer a_token')
          .set('If-None-Match', `"${modifiedTimestamp}"`)
          .send('a value');
        expect(store.put).to.have.been.called.with('zebcoe', '/locog/seats',
          'text/plain', Buffer.from('a value'), `"${modifiedTimestamp}"`);
      });

      it('tells the store to create a value conditionally based on If-None-Match', async () => {
        await req.put('/storage/zebcoe/locog/seats').buffer(true).type('text/plain')
          .set('Authorization', 'Bearer a_token')
          .set('If-None-Match', '*')
          .send('a value');
        expect(store.put).to.have.been.called.with('zebcoe', '/locog/seats', 'text/plain',
          Buffer.from('a value'), '*');
      });

      it('tells the store to save a value conditionally based on If-Match', async () => {
        await req.put('/storage/zebcoe/locog/seats').buffer(true).type('text/plain')
          .set('Authorization', 'Bearer a_token')
          .set('If-Match', `"${modifiedTimestamp}"`)
          .send('a value');
        expect(store.put).to.have.been.called.with('zebcoe', '/locog/seats', 'text/plain',
          Buffer.from('a value'), `"${modifiedTimestamp}"`);
      });

      it('does not tell the store to save a directory', async () => {
        await put('/storage/zebcoe/locog/seats/', 'a value');
        expect(store.put).to.have.been.called.exactly(0);
      });

      it('does not tell the store to save to a write-unauthorized directory', async () => {
        await put('/storage/zebcoe/books/house_of_leaves', 'a value');
        expect(store.put).to.have.been.called.exactly(0);
      });
    });

    describe('when an invalid access token is used', () => {
      const put = async (path, params) => {
        const ret = await req.put(path).buffer(true)
          .set('Authorization', 'Bearer bad_token').send(params);
        return ret;
      };

      it('does not tell the store to save the given value', async () => {
        await put('/storage/zebcoe/locog/seats', 'a value');
        expect(store.put).to.have.been.called.exactly(0);
      });
    });

    describe('when the store says the item was created', () => {
      before(() => {
        store.put = () => ({ created: true, modified: 1347016875231 });
      });

      const put = async (path, params) => {
        const ret = await req.put(path).buffer(true)
          .set('Authorization', 'Bearer a_token').send(params);
        return ret;
      };

      it('returns an empty 201 response', async () => {
        const res = await put('/storage/zebcoe/locog/seats', 'a value');
        expect(res).to.have.status(201);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res).to.have.header('ETag', '"1347016875231"');
        expect(res.text).to.be.equal('');
      });
    });

    describe('when the store says the item was not created but updated', () => {
      before(() => {
        store.put = () => ({ created: false, modified: 1347016875231 });
      });

      it('returns an empty 200 response', async () => {
        const res = await put('/storage/zebcoe/locog/seats', 'a value');
        expect(res).to.have.status(200);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res).to.have.header('ETag', '"1347016875231"');
        expect(res.text).to.be.equal('');
      });
    });

    describe('when the store says there was a version conflict', () => {
      before(() => {
        store.put = () => ({ created: false, modified: 1347016875231, conflict: true });
      });

      it('returns an empty 412 response', async () => {
        const res = await put('/storage/zebcoe/locog/seats', 'a value');
        expect(res).to.have.status(412);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res).to.have.header('ETag', '"1347016875231"');
        expect(res.text).to.be.equal('');
      });
    });

    describe('when the store says there was a folder-document clash', () => {
      before(() => {
        store.put = () => ({ created: false, isClash: true });
      });

      it('returns a 409 response', async () => {
        const res = await put('/storage/zebcoe/statuses/some-doc', 'some value');
        expect(res).to.have.status(409);
        expect(res).to.have.header('Cache-Control', 'no-cache');
        expect(res).to.have.header('Content-Length');
        // expect(res.text).to.equal('A document was found where a folder was expected, or vice-versa.');
      });
    });

    describe('when the store returns an error', () => {
      before(() => {
        store.put = () => { throw new Error('Something is technically wrong'); };
      });

      it('returns a 500 response with the error message', async () => {
        const res = await put('/storage/zebcoe/locog/seats', 'a value');
        expect(res).to.have.status(500);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res.text).to.be.equal('Something is technically wrong');
      });
    });
  });

  describe('DELETE', () => {
    store.delete = () => ({ deleted: true });
    const del = (path) => {
      return req.delete(path).buffer(true)
        .set('Authorization', 'Bearer a_token');
    };

    sandbox.restore();
    afterEach(() => {
      sandbox.restore();
    });

    beforeEach(() => {
      sandbox.on(store, ['delete']);
    });

    it('tells the store to delete the given item', async () => {
      await del('/storage/zebcoe/locog/seats');
      expect(store.delete).to.be.called.with('zebcoe', '/locog/seats', null);
    });

    it('tells the store to delete an item conditionally based on If-None-Match', async () => {
      await del('/storage/zebcoe/locog/seats')
        .set('If-None-Match', `"${modifiedTimestamp}"`);
      expect(store.delete).to.be.called.with('zebcoe', '/locog/seats', `"${modifiedTimestamp}"`);
    });

    it('tells the store to delete an item conditionally based on If-Match', async () => {
      await del('/storage/zebcoe/locog/seats')
        .set('If-Match', `"${modifiedTimestamp}"`);
      expect(store.delete).to.be.called.with('zebcoe', '/locog/seats', `"${modifiedTimestamp}"`);
    });

    describe('when the store says the item was deleted', () => {
      before(() => {
        store.delete = () => ({ deleted: true, modified: 1358121717830 });
      });

      it('returns an empty 200 response', async () => {
        const res = await del('/storage/zebcoe/locog/seats');
        expect(res).to.have.status(200);
        expect(res.text).to.be.equal('');
      });
    });

    describe('when the store says the item was not deleted', () => {
      before(() => {
        store.delete = () => ({ deleted: false, modified: 1358121717830 });
      });

      it('returns an empty 404 response', async () => {
        const res = await del('/storage/zebcoe/locog/seats');
        expect(res).to.have.status(404);
        expect(res.text).to.be.equal('');
      });
    });

    describe('when the store says there was a version conflict', () => {
      before(() => {
        store.delete = () => ({ deleted: false, modified: 1358121717830, conflict: true });
      });

      it('returns an empty 412 response', async () => {
        const res = await del('/storage/zebcoe/locog/seats');
        expect(res).to.have.status(412);
        expect(res.text).to.be.equal('');
      });
    });

    it('returns an empty 409 response when the store says there was a clash', async () => {
      store.delete = () => ({ deleted: false, isClash: true });
      const res = await del('/storage/zebcoe/locog/seats');
      expect(res).to.have.status(409);
      expect(res).to.have.header('Content-Length');
      expect(res.text).to.be.equal('');
      // expect(res.text).to.equal('A folder was found where a document was expected.');
    });

    describe('when the store returns an error', () => {
      before(() => {
        store.delete = () => { throw new Error('OH NOES!'); };
      });

      it('returns a 500 response with the error message', async () => {
        const res = await del('/storage/zebcoe/locog/seats');
        expect(res).to.have.status(500);
        expect(res).to.have.header('Access-Control-Allow-Origin', '*');
        expect(res.text).to.be.equal('OH NOES!');
      });
    });
  });
});
