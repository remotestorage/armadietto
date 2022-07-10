/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */

const fs = require('fs');
const path = require('path');
const chai = require('chai');
const spies = require('chai-spies');
const promisify = require('util').promisify;
const readFile = promisify(fs.readFile);
const chaiAsPromised = require('chai-as-promised');
const expect = chai.expect;
chai.use(chaiAsPromised);
chai.use(spies);
const { def, get, subject, sharedExamplesFor } = require('bdd-lazy-var/getter');
const { configureLogger } = require('../lib/logger');

sharedExamplesFor('Stores', (store) => {
  before(() => {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['warning', 'info'] });
  });

  describe('createUser', () => {
    subject('user', () => store.createUser(get.params));

    describe('with valid parameters', () => {
      def('params', { username: 'zebcoe1', email: 'zeb1@example.com', password: 'locog' });
      it('returns no errors', () => expect(get.user).to.be.fulfilled);
    });

    describe('with forbidden user name', () => {
      def('params', { username: '..', email: 'zeb@example.com', password: 'locog' });
      it('returns no errors', () => expect(get.user).to.be.rejectedWith(/Error: /));
    });

    describe('with user name containing spaces', () => {
      def('params', { username: 'john doe', email: 'jdoe@example.com', password: 'locog' });
      it('returns no errors', () => expect(get.user).to.be.rejectedWith(/Error: /));
    });

    describe('with no username', () => {
      def('params', { email: 'zeb@example.com', password: 'locog' });
      it('returns an error', () => expect(get.user)
        .to.be.rejectedWith('Error: Username must be at least 2 characters long'));
    });

    describe('with no email', () => {
      def('params', { username: 'zebcoe2', password: 'locog' });
      it('returns an error', () => expect(get.user)
        .to.be.rejectedWith('Error: Email must not be blank'));
    });

    describe('with no password', () => {
      def('params', { username: 'zebcoe3', email: 'zeb3@example.com' });
      it('returns an error', () => expect(get.user)
        .to.be.rejectedWith('Error: Password must not be blank'));
    });

    describe('with an existing user', () => {
      def('params', { username: 'zebcoe1', email: 'zeb1@example.com', password: 'locog' });
      it('returns an error', () => expect(get.user)
        .to.be.rejectedWith('The username “zebcoe1” is already taken'));
    });
  });

  describe('authenticate', () => {
    def('params', { username: 'boris1', email: 'boris1@example.com', password: 'zipwire' });
    before(async () => await store.createUser(get.params));
    subject('authenticate', () => store.authenticate(get.params));

    it('returns an error if the password is wrong', () => {
      get.params.password = 'bikes';
      return expect(get.authenticate).to.be.rejectedWith(/password/i);
    });

    it('returns no error for a valid username-password pair', () => {
      get.params.password = 'zipwire';
      expect(get.authenticate).to.eventually.be.ok;
    });

    it('returns an error if the user does not exist', () => {
      get.params.username = 'zeb';
      return expect(get.authenticate).to.be.rejectedWith(/name/i);
    });
  });

  describe('authorization methods', () => {
    def('params', { username: 'natasha', email: 'natasha@example.com', password: 'iloveyou' });
    def('permissions', { documents: ['w'], photos: ['r', 'w'], contacts: ['r'], 'deep/dir': ['r', 'w'] });
    before(async () => {
      await store.createUser(get.params);
    });

    describe('authorization', () => {
      it('should call authentication directly', async () => {
        chai.spy.on(store, 'authenticate');

        const token = await store.authorize('https://example.net', get.params.username, get.params.password, get.permissions);
        expect(token).to.be.a('string');
        expect(store.authenticate).to.have.been.called.once;
        expect(store.authenticate).to.have.been.called.with({ username: get.params.username, password: get.params.password });
      });

      it('should, if authentication throws an error, throw the same error', async () => {
        chai.spy.on(store, 'authenticate', () => { throw new Error('probe'); });

        await expect(store.authorize('https://example.net', get.params.username, get.params.password, get.permissions)).to.be.rejectedWith('probe');
      });

      afterEach(() => {
        chai.spy.restore();
      });
    });

    describe('permissions', () => {
      const clientAddress = '169.254.0.1';
      const host = 'storage.com';
      before(async () => {
        await store.createUser({ username: 'aaron', email: 'aaron@example.net', password: 'daslp' });
        this.accessToken = await store.authorize('www.example.com', 'natasha', get.params.password, get.permissions);
        this.abcAccessToken = await store.authorize('abc.org', 'natasha', get.params.password, { photos: ['r'] });
        this.rootToken = await store.authorize('admin.example.com', 'aaron', 'daslp', { '': ['r', 'w'] });
      });

      it('returns the users\'s authorizations', async () => {
        const auth = await store.permissions('natasha', this.accessToken, clientAddress, host);
        expect(auth).to.be.deep.equal({
          '/contacts/': ['r'],
          '/deep/dir/': ['r', 'w'],
          '/documents/': ['w'],
          '/photos/': ['r', 'w']
        });
        const auth2 = await store.permissions('natasha', this.abcAccessToken, clientAddress, host);
        expect(auth2).to.be.deep.equal({ '/photos/': ['r'] });

        const rootAuth = await store.permissions('aaron', this.rootToken, clientAddress, host);
        expect(rootAuth).to.be.deep.equal({ '/': ['r', 'w'] });
      });
    });

    describe('revokeAccess', () => {
      const clientAddress = '169.254.0.2';
      const host = 'storage.org';
      it('removes the authorization from the store', async () => {
        await store.revokeAccess('natasha', this.accessToken);
        const auth = await store.permissions('natasha', this.accessToken, clientAddress, host);
        expect(auth).to.be.deep.equal({});

        const auth2 = await store.permissions('natasha', this.abcAccessToken, clientAddress, host);
        expect(auth2).to.be.deep.equal({ '/photos/': ['r'] });
      });

      it('doesn\'t throw error if token doesn\'t correspond to any permissions', async () => {
        await store.revokeAccess('natasha', 'dGVzdDI6NjJBNjg5NjI67_uDfWRnvO5WBPzW1Hj_Wp_2p3U');
        await store.permissions('natasha', 'dGVzdDI6NjJBNjg5NjI67_uDfWRnvO5WBPzW1Hj_Wp_2p3U', clientAddress, host);
      });
    });
  });

  describe('storage methods', () => {
    before(async () => {
      try {
        await store.createUser({ username: 'boris', email: 'boris@example.com', password: 'zipwire' });
        await store.authorize('https://example.net', 'boris', 'zipwire', { '/': ['r', 'w'] });
      } catch (err) {
        console.error('while creating & authorizing “boris”');
      }
      try {
        await store.createUser({ username: 'zebcoe', email: 'zeb@example.com', password: 'locog' });
        await store.authorize('https://example.net', 'zebcoe', 'locog', { '/': ['r', 'w'] });
      } catch (err) {
        console.error('while creating & authorizing “zebcoe”');
      }
    });
    describe('put', () => {
      it('sets the value of an item', async () => {
        await store.put('boris', '/photos/zipwire', 'image/poster', Buffer.from('vertibo'), null);
        const { item } = await store.get('boris', '/photos/zipwire', null);
        expect(item.value).to.be.deep.equal(Buffer.from('vertibo'));
        expect(item.ETag).to.be.ok;
        expect(['string', 'number']).to.contain(typeof item.ETag);
        expect(item['Content-Type']).to.equal('image/poster');
        expect(item['Content-Length']).to.equal(7);
        expect(item['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);
      });

      it('stores binary data', async () => {
        const img = await readFile(path.join(__dirname, 'whut2.jpg'));
        await store.put('boris', '/photos/election', 'image/jpeg',
          img, null);
        const { item } = await store.get('boris', '/photos/election', null);
        expect(item.value).to.be.deep.equal(img);
        expect(item['Content-Type']).to.equal('image/jpeg');
        expect(item['Content-Length']).to.equal(46_134);
        expect(item['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);
      });

      it('sets the value of a public item', async () => {
        await store.put('boris', '/public/photos/zipwire2', 'image/poster', Buffer.from('vertibo'), null);
        let { item } = await store.get('boris', '/public/photos/zipwire2', null);
        expect(item.value).to.be.deep.equal(Buffer.from('vertibo'));
        expect(item['Content-Type']).to.equal('image/poster');
        expect(item['Content-Length']).to.equal(7);
        expect(item['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);
        ({ item } = await store.get('boris', '/photos/zipwire2', null));
        expect(item).to.be.null;
      });

      it('sets the value of a root item', async () => {
        await store.put('zebcoe', '/manifesto', 'text/plain', Buffer.from('gizmos'), null);
        const { item } = await store.get('zebcoe', '/manifesto', null);
        expect(item.value).to.be.deep.equal(Buffer.from('gizmos'));
        expect(item['Content-Type']).to.equal('text/plain');
        expect(item['Content-Length']).to.equal(6);
        expect(item['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);
      });

      it('sets the value of a deep item', async () => {
        await store.put('boris', '/deep/dir/secret', 'text/plain', Buffer.from('gizmos'), null);
        const { item } = await store.get('boris', '/deep/dir/secret', null);
        expect(item.value).to.be.deep.equal(Buffer.from('gizmos'));
        expect(item['Content-Type']).to.equal('text/plain');
        expect(item['Content-Length']).to.equal(6);
        expect(item['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);
      });

      it('returns true when a new item is created', async () => {
        const { created, modified } = await store.put('boris', '/photos/antani', 'image/poster', Buffer.from('veribo'), null);
        expect(created).to.be.true;
        expect(modified).to.be.ok;
        expect(['string', 'number']).to.contain(typeof modified);
      });

      it('returns true when a new category is created', async () => {
        const { created, modified, conflict } = await store.put('boris', '/documents/zipwire', 'image/poster', Buffer.from('vertibo'), null);
        expect(created).to.be.true;
        expect(modified).to.be.ok;
        expect(['string', 'number']).to.contain(typeof modified);
        expect(!conflict).to.be.true;
      });

      describe('for a nested document', () => {
        it('creates the parent folders', async () => {
          await store.put('boris', '/photos/foo/bar/qux', 'image/poster', Buffer.from('vertibo'), null);
          const { item } = await store.get('boris', '/photos/foo/bar/', null);
          expect(item.ETag).to.be.ok;
          expect(['string', 'number']).to.contain(typeof item.ETag);
          expect(item.items.qux.ETag).to.be.ok;
          expect(['string', 'number']).to.contain(typeof item.items.qux.ETag);
          expect(item.items.qux['Content-Length']).to.be.equal(7);
          expect(item.items.qux['Content-Type']).to.be.equal('image/poster');
          expect(item.items.qux['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);

          const { item: grandparent } = await store.get('boris', '/photos/foo/', null);
          expect(grandparent.ETag).to.be.ok;
          expect(['string', 'number']).to.contain(typeof grandparent.ETag);
          expect(['string', 'number']).to.contain(typeof grandparent.items['bar/'].ETag);
          expect(grandparent.items['bar/'].ETag).to.equal(item.ETag);

          const { item: greatGrand } = await store.get('boris', '/photos/', null);
          expect(greatGrand.ETag).to.be.ok;
          expect(['string', 'number']).to.contain(typeof greatGrand.ETag);
          expect(['string', 'number']).to.contain(typeof greatGrand.items['foo/'].ETag);
          expect(greatGrand.items['foo/'].ETag).to.equal(grandparent.ETag);

          const { item: root } = await store.get('boris', '/', null);
          expect(root.ETag).to.be.ok;
          expect(['string', 'number']).to.contain(typeof root.ETag);
          expect(['string', 'number']).to.contain(typeof root.items['photos/'].ETag);
          expect(root.items['photos/'].ETag).to.equal(greatGrand.ETag);
        });

        it('returns a clash & does not create path named as already existing document', async () => {
          const { created, isClash } = await store.put('boris', '/photos/zipwire/foo', 'image/poster', Buffer.from('vertibo'));
          expect(isClash).to.be.true;
          expect(created).to.be.false;
          const { item } = await store.get('boris', '/photos/zipwire/foo');
          expect(item).to.be.null;

          const { item: doc } = await store.get('boris', '/photos/zipwire', null);
          expect(doc.ETag).to.be.ok;
          expect(['string', 'number']).to.contain(typeof doc.ETag);
          expect(doc['Content-Type']).to.equal('image/poster');
          expect(doc['Content-Length']).to.equal(7);
          expect(doc['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);
        });
      });
    });

    describe('versioning', () => {
      it('does not set the value if a version is given for a non-existent item', async () => {
        await store.put('boris', '/photos/zipwire3', 'image/poster', Buffer.from('veribo'), '1-34567890123456789012345678901234');
        const { item } = await store.get('boris', '/photos/zipwire3');
        expect(item).to.be.null;
      });

      it('Sets the value if * is given for a non-existent item', async () => {
        await store.put('boris', '/photos/zipwire3', 'image/poster', Buffer.from('veribo'), '*');
        const { item } = await store.get('boris', '/photos/zipwire3');
        expect(item.value.toString()).to.be.equal('veribo');
        expect(item['Content-Type']).to.equal('image/poster');
        expect(item['Content-Length']).to.equal(6);
        expect(item['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);
      });

      it('updates the value if the given version is current', async () => {
        const firstResponse = await store.put('boris', '/notes/alpha', 'text/rtf',
          Buffer.from('first value'), null);
        await store.put('boris', '/notes/alpha', 'text/plain', Buffer.from('mayor'), firstResponse.modified);
        const { item } = await store.get('boris', '/notes/alpha');
        expect(item.value.toString()).to.be.equal('mayor');
        expect(item['Content-Type']).to.equal('text/plain');
        expect(item['Content-Length']).to.equal(5);
        expect(item['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);
      });

      it('does not set the value if the given version is not current', async () => {
        const firstResponse = await store.put('boris', '/notes/beta', 'text/css',
          Buffer.from('uno'), null);
        await store.put('boris', '/notes/beta', 'text/plain', Buffer.from('hair'), firstResponse.modified + 999);
        const { item } = await store.get('boris', '/notes/beta');
        expect(item.value.toString()).to.be.equal('uno');
        expect(item['Content-Type']).to.equal('text/css');
        expect(item['Content-Length']).to.equal(3);
        expect(item['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);
      });

      it('does not set the value if * is given for an existing item', async () => {
        await store.put('boris', '/notes/gamma', 'text/example',
          Buffer.from('erste'), null);
        await store.put('boris', '/notes/gamma', 'text/plain', Buffer.from('hair'), '*');
        const { item } = await store.get('boris', '/notes/gamma');
        expect(item.value.toString()).to.be.equal('erste');
        expect(item['Content-Type']).to.equal('text/example');
        expect(item['Content-Length']).to.equal(5);
        expect(item['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);
      });

      it('returns false with no conflict when the given version is current', async () => {
        const firstResponse = await store.put('boris', '/notes/delta', 'text/plain',
          Buffer.from('primis'), null);
        const currentVersion = firstResponse.modified;
        const { created, modified, conflict } = await store.put('boris', '/notes/delta', 'text/plain',
          Buffer.from('mayor'), currentVersion);
        expect(created).to.be.false;
        expect(modified).not.to.be.equal(currentVersion); // test can fail if store is *too* fast
        expect(conflict).to.be.false;
      });

      it('returns false with a conflict when the given version is not current', async () => {
        const { created, modified, conflict } = await store.put('boris', '/photos/election', 'image/jpeg',
          Buffer.from('mayor'), '1-34567890123456789012345678901234');
        expect(created).to.be.false;
        expect(modified).not.to.be.ok;
        expect(conflict).to.be.true;
      });
    });

    describe('get', () => {
      describe('for documents', () => {
        it('returns an existing resource', async () => {
          const startTime = Date.now();
          await store.put('boris', '/photos/zipwire4', 'image/poster', Buffer.from('vertibo'));
          const { item } = await store.get('boris', '/photos/zipwire4');
          expect(['string', 'number']).to.contain(typeof item.ETag);
          expect(item.ETag).to.be.ok;
          expect(item['Content-Type']).to.equal('image/poster');
          expect(item['Content-Length']).to.equal(7);
          expect(item['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);
          expect(Date.parse(item['Last-Modified'])).to.be.closeTo(startTime, 1000);
          expect(item.value).to.deep.equal(Buffer.from('vertibo'));
          expect(item).to.be.an('object').that.has.all.keys('ETag', 'Content-Type', 'Content-Length', 'Last-Modified', 'value');
        });

        it('returns null for a non-existant key', async () => {
          const { item } = await store.get('boris', '/photos/lympics');
          expect(item).to.be.null;
        });

        it('returns null for a non-existant category', async () => {
          const { item } = await store.get('boris', '/madeup/lympics');
          expect(item).to.be.null;
        });

        /** Stores SHOULD also set isClash true, but are not required to,
         * if it would require extra calls to storage on every request. */
        it('returns null when folder is retrieved as document', async () => {
          await expect(store.put('boris', '/scope/some-folder/sound', 'audio/example', Buffer.from('ldjaflkdsjfklds'))).to.eventually.include({ created: true, conflict: false });
          const { item /*, isClash */ } = await store.get('boris', '/scope/some-folder');
          expect(item).to.be.null;
          // expect(isClash).to.be.true;
        });

        describe('versioning', () => {
          it('returns a versionMatch if the given version is current', async () => {
            const { item } = await store.get('boris', '/photos/zipwire');
            const { versionMatch } = await store.get('boris', '/photos/zipwire', item.ETag);
            expect(versionMatch).to.be.true;
          });

          it('returns no versionMatch if the given version is not current', async () => {
            const { versionMatch } = await store.get('boris', '/photos/zipwire', '1-1234567');
            expect(Boolean(versionMatch)).to.be.false;
          });
        });
      });

      describe('for directories', async () => {
        it('returns a directory listing for a folder', async () => {
          const startTime = Date.now();
          await store.put('boris', '/photos/bar/boo', 'text/plain', Buffer.from('some content'));
          await store.put('boris', '/photos/bar/qux/boo', 'text/plain', Buffer.from('some content'));
          const { item } = await store.get('boris', '/photos/bar/');
          expect(['string', 'number']).to.contain(typeof item.items.boo.ETag);
          expect(item.items.boo.ETag).to.be.ok;
          expect(item.items.boo['Content-Type']).to.equal('text/plain');
          expect(item.items.boo['Content-Length']).to.equal(12);
          expect(item.items.boo['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);
          expect(Date.parse(item.items.boo['Last-Modified'])).to.be.closeTo(startTime, 1000);
          expect(item.items.boo).to.be.an('object').that.has.all.keys('ETag', 'Content-Type', 'Content-Length', 'Last-Modified');
          expect(item.items['qux/']).to.be.deep.equal({
            ETag: item.items['qux/'].ETag
          });
          expect(Object.keys(item.items)).to.deep.equal(['boo', 'qux/']);
        });

        it('returns a directory listing for the root folder', async () => {
          const startTime = Date.now();
          await store.put('boris', '/singleton', 'application/identity', Buffer.from('me, myself & I'));
          const { item } = await store.get('boris', '/');
          expect(item.ETag).to.be.ok;
          expect(['string', 'number']).to.contain(typeof item.ETag);
          expect(item.items).to.be.an.instanceof(Object);
          expect(['string', 'number']).to.contain(typeof item.items.singleton.ETag);
          expect(item.items.singleton.ETag).to.be.ok;
          expect(item.items.singleton['Content-Type']).to.equal('application/identity');
          expect(item.items.singleton['Content-Length']).to.equal(14);
          expect(item.items.singleton['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);
          expect(Date.parse(item.items.singleton['Last-Modified'])).to.be.closeTo(startTime, 1000);
          expect(Object.keys(item.items.singleton)).to.deep.equal(['ETag', 'Content-Type', 'Content-Length', 'Last-Modified']);
        });

        /**
         * The spec says: "GET requests to empty folders SHOULD be responded to
         * with a folder description with no items (the items field set to '{}')."
         * We also allow a store to say the folder doesn't exist.
         */
        it('returns empty list or null for a non-existent directory', async () => {
          const { item } = await store.get('boris', '/photos/qux/');
          if (item instanceof Object) {
            expect(item.items).to.be.deep.equal({});
          } else {
            expect(Boolean(item)).to.equal(false);
          }
        });

        describe('with a document with the same name as a directory', () => {
          it('returns a clash', async () => {
            const { isClash } = await store.put('boris', '/photos/bar', 'text/plain', Buffer.from('ciao'));
            expect(isClash).to.be.true;
          });
        });

        /** Stores SHOULD return item null & isClash true, but are not required to,
         * if it would require extra calls to storage on every request.
         * Each store should implement a test validating the response it implements. */
        it('should not throw error when document is retrieved as folder', async () => {
          await expect(store.put('boris', '/scope/fonts', 'font/example', Buffer.from('fljadlkf'))).to.eventually.include({ created: true, conflict: false });
          /* const { item, isClash } = */ await store.get('boris', '/scope/fonts/');
          // expect(item).to.be.null;
          // expect(isClash).to.be.true;
        });
      });
    });

    describe('head', () => {
      describe('for documents', () => {
        it('returns headers for an existing resource', async () => {
          const startTime = Date.now();
          await store.put('boris', '/taxes/1972', 'text/csv', Buffer.from('$2032.17'));
          const { item } = await store.get('boris', '/taxes/1972', null, true);
          expect(['string', 'number']).to.contain(typeof item.ETag);
          expect(item.ETag).to.be.ok;
          expect(item['Content-Type']).to.equal('text/csv');
          expect(item['Content-Length']).to.equal(8);
          expect(item['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);
          expect(Date.parse(item['Last-Modified'])).to.be.closeTo(startTime, 1000);
          expect(Boolean(item.value)).to.equal(false);
          expect(item).to.be.an('object').that.has.all.keys('ETag', 'Content-Type', 'Content-Length', 'Last-Modified', 'value');
        });
      });

      describe('for folders', () => {
        it('returns headers for the root folder', async () => {
          const startTime = Date.now();
          await store.put('boris', '/soliton', 'text/example', Buffer.from('I think, therefore I am.'));
          const { item } = await store.get('boris', '/', null, true);
          expect(item.ETag).to.be.ok;
          expect(['string', 'number']).to.contain(typeof item.ETag);
          expect(item.items).to.be.an.instanceof(Object);
          expect(['string', 'number']).to.contain(typeof item.items.soliton.ETag);
          expect(item.items.soliton.ETag).to.be.ok;
          expect(item.items.soliton['Content-Type']).to.equal('text/example');
          expect(item.items.soliton['Content-Length']).to.equal(24);
          expect(item.items.soliton['Last-Modified']).matches(/^\w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d GMT$/);
          expect(Date.parse(item.items.soliton['Last-Modified'])).to.be.closeTo(startTime, 1000);
          expect(Object.keys(item.items.soliton)).to.deep.equal(['ETag', 'Content-Type', 'Content-Length', 'Last-Modified']);
          expect(Boolean(item.value)).to.be.false;
        });
      });
    });

    describe('delete', () => {
      it('deletes an item', async () => {
        await store.put('boris', '/photos/election', '/image/jpeg', Buffer.from('hair'));
        const { item: itemBefore } = await store.get('boris', '/photos/election');
        expect(itemBefore).not.to.be.null;
        const { deleted, modified } = await store.delete('boris', '/photos/election');
        expect(deleted).to.be.true;
        expect(typeof modified).to.equal('string');
        const { item: itemAfter } = await store.get('boris', '/photos/election');
        expect(itemAfter).to.be.null;
      });

      it('removes empty directories when items are deleted', async () => {
        const { item } = await store.get('boris', '/photos/election');
        expect(item).to.be.null;
      });

      it('returns false when a non-existant item is deleted', async () => {
        const { deleted } = await store.delete('boris', '/photos/zipzop');
        expect(deleted).to.be.false;
      });

      /** The store MAY also return isClash true */
      it('returns false and conflict false if path refers to folder', async () => {
        await store.put('boris', '/notes/school/english', 'text/rtf', Buffer.from('hair'));
        const { deleted, conflict } = await store.delete('boris', '/notes/school');
        expect(deleted).to.be.false;
        expect(Boolean(conflict)).to.be.false;
      });

      describe('versioning', () => {
        it('deletes the item if the given version is current', async () => {
          await store.put('boris', '/photos/election', 'text/csv', Buffer.from('bar'));
          const { item } = await store.get('boris', '/photos/election');
          const { deleted } = await store.delete('boris', '/photos/election', item.ETag);
          expect(deleted).to.be.true;
        });

        it('does not delete the item and returns conflict if the given version is not current', async () => {
          await store.put('boris', '/photos/election', 'text/tab-separated-values', Buffer.from('bar'));
          const { deleted, conflict } = await store.delete('boris', '/photos/election', '1-34567890123456789012345678901234');
          expect(deleted).to.be.false;
          expect(conflict).to.be.true;
        });

        it('returns conflict if the given version is not current and the document doesn\'t exist', async () => {
          const { deleted, conflict } = await store.delete('boris', '/photos/sir-not-appearing-in-this-show', '1-34567890123456789012345678901234');
          expect(deleted).to.be.false;
          expect(conflict).to.be.true;
        });
      });
    });
  });
});
