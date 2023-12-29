/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */

const fs = require('fs');
const path = require('path');
const chai = require('chai');
const promisify = require('util').promisify;
const readFile = promisify(fs.readFile);
const chaiAsPromised = require('chai-as-promised');
const expect = chai.expect;
chai.use(chaiAsPromised);
const { def, get, subject, sharedExamplesFor } = require('bdd-lazy-var/getter');

sharedExamplesFor('Stores', (store) => {
  describe('createUser', () => {
    subject('user', () => store.createUser(get.params));

    describe('with valid parameters', () => {
      def('params', { username: 'zebcoe', email: 'zeb@example.com', password: 'locog' });
      it('returns no errors', () => expect(get.user).to.be.fulfilled);
    });

    describe('with no username', () => {
      def('params', { email: 'zeb@example.com', password: 'locog' });
      it('returns an error', () => expect(get.user)
        .to.be.rejectedWith('Error: Username must be at least 2 characters long'));
    });

    describe('with no email', () => {
      def('params', { username: 'zebcoe', password: 'locog' });
      it('returns an error', () => expect(get.user)
        .to.be.rejectedWith('Error: Email must not be blank'));
    });

    describe('with no password', () => {
      def('params', { username: 'zebcoe', email: 'zeb@example.com' });
      it('returns an error', () => expect(get.user)
        .to.be.rejectedWith('Error: Password must not be blank'));
    });

    describe('with an existing user', () => {
      def('params', { username: 'zebcoe', email: 'zeb@example.com', password: 'locog' });
      it('returns an error', () => expect(get.user)
        .to.be.rejectedWith('The username is already taken'));
    });
  });

  describe('authenticate', () => {
    def('params', { username: 'boris', email: 'boris@example.com', password: 'zipwire' });
    before(() => store.createUser(get.params));
    subject('authenticate', () => store.authenticate(get.params));

    it('returns no error for a valid username-password pairs', () =>
      expect(get.authenticate).to.eventually.be.true);

    it('returns an error if the password is wrong', () => {
      get.params.password = 'bikes';
      return expect(get.authenticate).to.be.rejectedWith('Incorrect password');
    });

    it('returns an error if the user does not exist', () => {
      get.params.username = 'zeb';
      return expect(get.authenticate).to.be.rejectedWith('Username not found');
    });
  });

  describe('authorization methods', () => {
    def('permissions', { documents: ['w'], photos: ['r', 'w'], contacts: ['r'], 'deep/dir': ['r', 'w'] });
    before(async () => {
      // await store.createUser({username: 'boris', email: 'boris@example.com', password: 'dangle'});
      this.accessToken = await store.authorize('www.example.com', 'boris', get.permissions);

      // await store.createUser({username: 'zebcoe', email: 'zeb@example.com', password: 'locog'});
      this.rootToken = await store.authorize('admin.example.com', 'zebcoe', { '': ['r', 'w'] });
    });

    describe('permissions', () => {
      it('returns the users\'s authorizations', async () => {
        const auth = await store.permissions('boris', this.accessToken);
        expect(auth).to.be.deep.equal({
          '/contacts/': ['r'],
          '/deep/dir/': ['r', 'w'],
          '/documents/': ['w'],
          '/photos/': ['r', 'w']
        });
      });
    });

    describe('revokeAccess', () => {
      it('removes the authorization from the store', async () => {
        await store.revokeAccess('boris', this.accessToken);
        const auth = await store.permissions('boris', this.accessToken);
        expect(auth).to.be.deep.equal({});
      });
    });
  });

  describe('storage methods', () => {
    describe('put', () => {
      it('sets the value of an item', async () => {
        await store.put('boris', '/photos/zipwire', 'image/poster', Buffer.from('vertibo'), null);
        const { item } = await store.get('boris', '/photos/zipwire', null);
        expect(item.value).to.be.deep.equal(Buffer.from('vertibo'));
      });

      it('stores binary data', async () => {
        const img = await readFile(path.join(__dirname, 'whut2.jpg'));
        await store.put('boris', '/photos/election', 'image/jpeg',
          img, null);
        const { item } = await store.get('boris', '/photos/election', null);
        expect(item.value).to.be.deep.equal(img);
      });

      it('sets the value of a public item', async () => {
        await store.put('boris', '/public/photos/zipwire2', 'image/poster', Buffer.from('vertibo'), null);
        let { item } = await store.get('boris', '/public/photos/zipwire2', null);
        expect(item.value).to.be.deep.equal(Buffer.from('vertibo'));
        ({ item } = await store.get('boris', '/photos/zipwire2', null));
        expect(item).to.be.null;
      });

      it('sets the value of a root item', async () => {
        await store.put('zebcoe', '/manifesto', 'text/plain', Buffer.from('gizmos'), null);
        const { item } = await store.get('zebcoe', '/manifesto', null);
        expect(item.value).to.be.deep.equal(Buffer.from('gizmos'));
      });

      it('sets the value of a deep item', async () => {
        await store.put('boris', '/deep/dir/secret', 'text/plain', Buffer.from('gizmos'), null);
        const { item } = await store.get('boris', '/deep/dir/secret', null);
        expect(item.value).to.be.deep.equal(Buffer.from('gizmos'));
      });

      it('returns true with a timestamp when a new item is created', async () => {
        const before = new Date().getTime();
        const { created, modified } = await store.put('boris', '/photos/antani', 'image/poster', Buffer.from('veribo'), null);
        const after = new Date().getTime();
        expect(created).to.be.true;
        expect(parseInt(modified)).to.be.lte(after).and.gte(before);
      });

      it('returns true with a timestamp when a new category is created', async () => {
        const before = new Date().getTime();
        const { created, modified, conflict } = await store.put('boris', '/documents/zipwire', 'image/poster', Buffer.from('vertibo'), null);
        const after = new Date().getTime();
        expect(created).to.be.true;
        expect(parseInt(modified)).to.be.lte(after).and.gte(before);
        expect(!conflict).to.be.true;
      });

      describe('for a nested document', () => {
        it('created the parent directory', async () => {
          await store.put('boris', '/photos/foo/bar/qux', 'image/poster', Buffer.from('vertibo'), null);
          const { item } = await store.get('boris', '/photos/foo/bar/', null);
          expect(item.items.qux['Content-Length']).to.be.equal(7);
          expect(item.items.qux['Content-Type']).to.be.equal('image/poster');
        });

        it('does not create path named as already existing document', async () => {
          const { created } = await store.put('boris', '/photos/zipwire/foo', 'image/poster', Buffer.from('vertibo'));
          expect(created).to.be.false;
          const { item } = await store.get('boris', '/photos/zipwire/foo');
          expect(item).to.be.null;
        });
      });
    });

    describe('versioning', () => {
      it('does not set the value if a version is given for a non-existent item', async () => {
        await store.put('boris', '/photos/zipwire3', 'image/poster', Buffer.from('veribo'), '12345');
        const { item } = await store.get('boris', '/photos/zipwire3');
        expect(item).to.be.null;
      });

      it('does not set the value if * is given for a non-existent item', async () => {
        await store.put('boris', '/photos/zipwire3', 'image/poster', Buffer.from('veribo'), '*');
        const { item } = await store.get('boris', '/photos/zipwire3');
        expect(item.value.toString()).to.be.equal('veribo');
      });

      it('sets the value if the given version is current', async () => {
        const { item: oldItem } = await store.get('boris', '/photos/election');
        await store.put('boris', '/photos/election', 'image/jpeg', Buffer.from('mayor'), oldItem.ETag);
        const { item } = await store.get('boris', '/photos/election');
        expect(item.value.toString()).to.be.equal('mayor');
      });

      it('does not set the value if the given version is not current', async () => {
        const { item: oldItem } = await store.get('boris', '/photos/election');
        const version = parseInt(oldItem.ETag) + 1;
        await store.put('boris', '/photos/election', 'image/jpeg', Buffer.from('hair'), version.toString());
        const { item } = await store.get('boris', '/photos/election');
        expect(item.value.toString()).to.be.equal('mayor');
      });

      it('does not set the value if * is given for an existing item', async () => {
        await store.put('boris', '/photos/election', 'image/jpeg', Buffer.from('hair'), '*');
        const { item } = await store.get('boris', '/photos/election');
        expect(item.value.toString()).to.be.equal('mayor');
      });

      it('returns false with no conflict when the given version is current', async () => {
        const { item } = await store.get('boris', '/photos/election');
        const currentVersion = item.ETag;
        const { created, modified, conflict } = await store.put('boris', '/photos/election', 'image/jpeg',
          Buffer.from('mayor'), currentVersion);
        expect(created).to.be.false;
        expect(modified).not.to.be.equal(currentVersion);
        expect(conflict).to.be.false;
      });

      it('returns false with a conflict when the given version is not current', async () => {
        const { created, modified, conflict } = await store.put('boris', '/photos/election', 'image/jpeg',
          Buffer.from('mayor'), '123456');
        expect(created).to.be.false;
        expect(modified).not.to.be.ok;
        expect(conflict).to.be.true;
      });
    });

    describe('get', () => {
      describe('for documents', () => {
        it('returns an existing resource', async () => {
          await store.put('boris', '/photos/zipwire', 'image/poster', Buffer.from('vertibo'));
          const { item } = await store.get('boris', '/photos/zipwire');
          expect(item).to.be.deep.equal({
            'Content-Length': 7,
            'Content-Type': 'image/poster',
            ETag: item.ETag,
            value: Buffer.from('vertibo')
          });
        });

        it('returns null for a non-existant key', async () => {
          const { item } = await store.get('boris', '/photos/lympics');
          expect(item).to.be.null;
        });

        it('returns null for a non-existant category', async () => {
          const { item } = await store.get('boris', '/madeup/lympics');
          expect(item).to.be.null;
        });

        describe('versioning', () => {
          it('returns a versionMatch if the given version is current', async () => {
            const { item } = await store.get('boris', '/photos/zipwire');
            const { versionMatch } = await store.get('boris', '/photos/zipwire', item.ETag);
            expect(versionMatch).to.be.true;
          });

          it('returns no versionMatch if the given version is not current', async () => {
            const { versionMatch } = await store.get('boris', '/photos/zipwire', '1234567');
            expect(versionMatch).to.be.false;
          });
        });

        describe('for directories', async () => {
          it('returns a directory listing for a folder', async () => {
            await store.put('boris', '/photos/bar/boo', 'text/plain', Buffer.from('some content'));
            await store.put('boris', '/photos/bar/qux/boo', 'text/plain', Buffer.from('some content'));
            const { item } = await store.get('boris', '/photos/bar/');
            expect(Object.keys(item.items)).to.be.length(2);
            expect(item.items.boo).to.be.deep.equal({
              'Content-Type': 'text/plain',
              'Content-Length': 12,
              ETag: item.items.boo.ETag
            });
            expect(item.items['qux/']).to.be.deep.equal({
              ETag: item.items['qux/'].ETag
            });
          });

          it('returns null for a non-existant directory', async () => {
            const { item } = await store.get('boris', '/photos/qux/');
            expect(item.items).to.be.deep.equal({});
          });

          describe('with a document with the same name as a directory', () => {
            it('returns an isDir conflict', async () => {
              const { isDir } = await store.put('boris', '/photos/bar', 'text/plain', Buffer.from('ciao'));
              expect(isDir).to.be.true;
            });
          });
        });
      });
    });

    describe('delete', () => {
      it('deletes an item', async () => {
        await store.put('boris', '/photos/election', '/image/jpeg', Buffer.from('hair'));
        const { item: itemBefore } = await store.get('boris', '/photos/election');
        expect(itemBefore).not.to.be.null;
        const { deleted } = await store.delete('boris', '/photos/election');
        expect(deleted).to.be.true;
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

      describe('versioning', () => {
        it('deletes the item if the given version is current', async () => {
          await store.put('boris', '/photos/election', null, Buffer.from('bar'));
          const { item } = await store.get('boris', '/photos/election');
          const { deleted } = await store.delete('boris', '/photos/election', item.ETag);
          expect(deleted).to.be.true;
        });

        it('does not delete the item and returns conflict if the given version is not current', async () => {
          await store.put('boris', '/photos/election', null, Buffer.from('bar'));
          const { deleted, conflict } = await store.delete('boris', '/photos/election', '123456');
          expect(deleted).to.be.false;
          expect(conflict).to.be.true;
        });
      });
    });
  });
});
