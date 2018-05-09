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
      def('params', {username: 'zebcoe', email: 'zeb@example.com', password: 'locog'});
      it('returns no errors', () => expect(get.user).to.be.fulfilled);
    });

    describe('with no username', () => {
      def('params', {email: 'zeb@example.com', password: 'locog'});
      it('returns an error', () => expect(get.user)
        .to.be.rejectedWith('Error: Username must be at least 2 characters long'));
    });

    describe('with no email', () => {
      def('params', {username: 'zebcoe', password: 'locog'});
      it('returns an error', () => expect(get.user)
        .to.be.rejectedWith('Error: Email must not be blank'));
    });

    describe('with no password', () => {
      def('params', {username: 'zebcoe', email: 'zeb@example.com'});
      it('returns an error', () => expect(get.user)
        .to.be.rejectedWith('Error: Password must not be blank'));
    });

    describe('with an existing user', () => {
      def('params', {username: 'zebcoe', email: 'zeb@example.com', password: 'locog'});
      it('returns an error', () => expect(get.user)
        .to.be.rejectedWith('The username is already taken'));
    });
  });

  describe('authenticate', () => {
    def('params', {username: 'boris', email: 'boris@example.com', password: 'zipwire'});
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
    def('permissions', {documents: ['w'], photos: ['r', 'w'], contacts: ['r'], 'deep/dir': ['r', 'w']});
    before(async () => {
      // await store.createUser({username: 'boris', email: 'boris@example.com', password: 'dangle'});
      this.accessToken = await store.authorize('www.example.com', 'boris', get.permissions);

      // await store.createUser({username: 'zebcoe', email: 'zeb@example.com', password: 'locog'});
      this.rootToken = await store.authorize('admin.example.com', 'zebcoe', {'': ['r', 'w']});
    });

    describe('permissions', () => {
      it('returns the users\'s authorizations', async () => {
        const auth = await store.permissions('boris', this.accessToken);
        expect(auth).to.be.deep.equal({ '/contacts/': ['r'],
          '/deep/dir/': ['r', 'w'],
          '/documents/': ['w'],
          '/photos/': ['r', 'w'] });
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
    def('date', Date.UTC(2012, 1, 25, 13, 37));
    def('oldDate', Date.UTC(1984, 6, 5, 11, 11));
    describe('put', () => {
      it('sets the value of an item', async () => {
        await store.put('boris', '/photos/zipwire', 'image/poster', Buffer.from('vertibo'), null);
        const {item} = await store.get('boris', '/photos/zipwire', null);
        expect(item.value).to.be.deep.equal(Buffer.from('vertibo'));
      });

      it('stores binary data', async () => {
        const img = await readFile(path.join(__dirname, 'whut2.jpg'));
        await store.put('boris', '/photos/election', 'image/jpeg',
          img, null);
        const {item} = await store.get('boris', '/photos/election', null);
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

      // it('returns true with a timestamp when a new item is created', async () => {
      //   const before = Date.now();
      //   const {created, modified} = await store.put('boris', '/photos/zipwire', 'image/poster', Buffer.from('veribo'), null);
      //   const after = Date.now();
      //   expect(created).to.be.true;
      // });
    });
  });
});

// });

// describe('storage methods', () => {
//   before(() => {
//     this.date = Date.UTC(2012, 1, 25, 13, 37);
//     this.oldDate = Date.UTC(1984, 6, 5, 11, 11);
//     stub('new', 'Date').returns({getTime: () => { return date; }});
//     stub(Date, 'now').returns(date); // make Node 0.9 happy
//   });

//     it('returns true with a timestamp when a new item is created', () => {
//       store.put('boris', '/photos/zipwire', 'image/poster', buffer('vertibo'), null, function (error, created, modified, conflict) {
//         resume(() => {
//           assertNull(error);
//           assert(created);
//           assertEqual(date, modified);
//           assert(!conflict);
//         });
//       });
//     });

//     it('returns true with a timestamp when a new category is created', () => {
//       store.put('boris', '/documents/zipwire', 'image/poster', buffer('vertibo'), null, function (error, created, modified, conflict) {
//         resume(() => {
//           assertNull(error);
//           assert(created);
//           assertEqual(date, modified);
//           assert(!conflict);
//         });
//       });
//     });

//     it('returns false with a timestamp when an existing item is modified', () => {
//       store.put('boris', '/photos/election', 'text/plain', buffer('hair'), null, function (error, created, modified, conflict) {
//         resume(() => {
//           assertNull(error);
//           assert(!created);
//           assertEqual(date, modified);
//           assert(!conflict);
//         });
//       });
//     });

//     describe('for a nested document', () => {
//       before(() => {
//         store.put('boris', '/photos/foo/bar/qux', 'image/poster', buffer('vertibo'), null, resume);
//       });

//       it('creates the parent directory', () => {
//         store.get('boris', '/photos/foo/bar/', null, function (error, items) {
//           resume(() => {
//             assertEqual({ children: [{name: 'qux', modified: date}], modified: date }, items);
//           });
//         });
//       });

//       it('creates the grandparent directory', () => {
//         store.get('boris', '/photos/foo/', null, function (error, items) {
//           resume(() => {
//             assertEqual({ children: [{name: 'bar/', modified: date}], modified: date }, items);
//           });
//         });
//       });
//     });

//     describe('versioning', () => {
//       it('does not set the value if a version is given for a non-existent item', () => {
//         store.put('boris', '/photos/zipwire', 'image/poster', buffer('vertibo'), date, () => {
//           store.get('boris', '/photos/zipwire', null, function (error, item) {
//             resume(() => { assertNull(item); });
//           });
//         });
//       });

//       it('sets the value if * is given for a non-existent item', () => {
//         store.put('boris', '/photos/zipwire', 'image/poster', buffer('vertibo'), '*', () => {
//           store.get('boris', '/photos/zipwire', null, function (error, item) {
//             resume(() => { assertEqual(buffer('vertibo'), item.value); });
//           });
//         });
//       });

//       it('sets the value if the given version is current', () => {
//         store.put('boris', '/photos/election', 'image/jpeg', buffer('mayor'), date, () => {
//           store.get('boris', '/photos/election', null, function (error, item) {
//             resume(() => { assertEqual(buffer('mayor'), item.value); });
//           });
//         });
//       });

//       it('does not set the value if the given version is not current', () => {
//         store.put('boris', '/photos/election', 'image/jpeg', buffer('mayor'), oldDate, () => {
//           store.get('boris', '/photos/election', null, function (error, item) {
//             resume(() => { assertEqual(buffer('hair'), item.value); });
//           });
//         });
//       });

//       it('does not set the value if * is given for an existing item', () => {
//         store.put('boris', '/photos/election', 'image/jpeg', buffer('mayor'), '*', () => {
//           store.get('boris', '/photos/election', null, function (error, item) {
//             resume(() => { assertEqual(buffer('hair'), item.value); });
//           });
//         });
//       });

//       it('returns false with no conflict when the given version is current', () => {
//         store.put('boris', '/photos/election', 'image/jpeg', buffer('mayor'), date, function (error, created, modified, conflict) {
//           resume(() => {
//             assertNull(error);
//             assert(!created);
//             assertEqual(date, modified);
//             assert(!conflict);
//           });
//         });
//       });

//       it('returns false with a conflict when the given version is not current', () => {
//         store.put('boris', '/photos/election', 'image/jpeg', buffer('mayor'), oldDate, function (error, created, modified, conflict) {
//           resume(() => {
//             assertNull(error);
//             assert(!created);
//             assertNull(modified);
//             assert(conflict);
//           });
//         });
//       });
//     });
//   });

//   describe('get', () => {
//     describe('for documents', () => {
//       before(() => {
//         store.put('boris', '/photos/zipwire', 'image/poster', buffer('vertibo'), null, resume);
//       });

//       it('returns an existing resource', () => {
//         store.get('boris', '/photos/zipwire', null, function (error, item, match) {
//           resume(() => {
//             assertNull(error);
//             assertEqual({length: 7, type: 'image/poster', modified: date, value: buffer('vertibo')}, item);
//             assert(!match);
//           });
//         });
//       });

//       it('returns null for a non-existant key', () => {
//         store.get('boris', '/photos/lympics', null, function (error, item, match) {
//           resume(() => {
//             assertNull(error);
//             assertNull(item);
//             assert(!match);
//           });
//         });
//       });

//       it('returns null for a non-existant category', () => {
//         store.get('boris', '/madeup/lympics', null, function (error, item, match) {
//           resume(() => {
//             assertNull(error);
//             assertNull(item);
//             assert(!match);
//           });
//         });
//       });

//       describe('versioning', () => {
//         it('returns a match if the given version is current', () => {
//           store.get('boris', '/photos/zipwire', date, function (error, item, match) {
//             resume(() => {
//               assertNull(error);
//               assertEqual({length: 7, type: 'image/poster', modified: date, value: buffer('vertibo')}, item);
//               assert(match);
//             });
//           });
//         });

//         it('returns no match if the given version is not current', () => {
//           store.get('boris', '/photos/zipwire', oldDate, function (error, item, match) {
//             resume(() => {
//               assertNull(error);
//               assertEqual({length: 7, type: 'image/poster', modified: date, value: buffer('vertibo')}, item);
//               assert(!match);
//             });
//           });
//         });
//       });
//     });

//     describe('for directories', () => {
//       before(() => {
//         // Example data taken from http://www.w3.org/community/unhosted/wiki/RemoteStorage-2012.04#GET
//         store.put('boris', '/photos/bar/qux/boo', 'text/plain', buffer('some content'), null, () => {
//           store.put('boris', '/photos/bla', 'application/json', buffer('{"more": "content"}'), null, () => {
//             store.put('zebcoe', '/tv/shows', 'application/json', buffer('{"The Day": "Today"}'), null, resume);
//           });
//         });
//       });

//       it('returns a directory listing for a category', () => {
//         store.get('boris', '/photos/', null, function (error, items) {
//           resume(() => {
//             assertNull(error);
//             assertEqual({ children: [{name: 'bar/', modified: date}, {name: 'bla', modified: date}], modified: date }, items);
//           });
//         });
//       });

//       it('returns a directory listing for the root category', () => {
//         store.get('zebcoe', '/', null, function (error, items) {
//           resume(() => {
//             assertNull(error);
//             assertEqual({ children: [{name: 'tv/', modified: date}], modified: date }, items);
//           });
//         });
//       });

//       it('returns null for a non-existant directory', () => {
//         store.get('boris', '/photos/foo/', null, function (error, items) {
//           resume(() => {
//             assertNull(error);
//             assertEqual(null, items);
//           });
//         });
//       });

//       describe('with a document with the same name as a directory', () => {
//         before(() => {
//           store.put('boris', '/photos.d', 'application/json', buffer('{"The Day": "Today"}'), null, function (error) {
//             resume(() => { assertNull(error); });
//           });
//         });

//         it('returns a directory listing for a category', () => {
//           store.get('boris', '/photos/', null, function (error, items) {
//             resume(() => {
//               assertNull(error);
//               assertEqual({ children: [{name: 'bar/', modified: date}, {name: 'bla', modified: date}], modified: date }, items);
//             });
//           });
//         });
//       });
//     });
//   });

//   describe('delete', () => {
//     before(() => {
//       store.put('boris', '/photos/election', 'image/jpeg', buffer('hair'), null, () => {
//         store.put('boris', '/photos/bar/qux/boo', 'text/plain', buffer('some content'), null, resume);
//       });
//     });

//     it('deletes an item', () => {
//       store.delete('boris', '/photos/election', null, () => {
//         store.get('boris', '/photos/election', null, function (error, item) {
//           resume(() => { assertNull(item); });
//         });
//       });
//     });

//     it('removes empty directories when items are deleted', () => {
//       store.delete('boris', '/photos/bar/qux/boo', null, () => {
//         store.get('boris', '/photos/', null, function (error, items) {
//           resume(() => {
//             assertNotEqual(arrayIncluding(objectIncluding({name: 'bar/'})), items.children);
//           });
//         });
//       });
//     });

//     it('returns true when an existing item is deleted', () => {
//       store.delete('boris', '/photos/election', null, function (error, deleted, modified, conflict) {
//         resume(() => {
//           assertNull(error);
//           assert(deleted);
//           assertEqual(date, modified);
//           assert(!conflict);
//         });
//       });
//     });

//     it('returns false when a non-existant item is deleted', () => {
//       store.delete('boris', '/photos/zipwire', null, function (error, deleted, modified, conflict) {
//         resume(() => {
//           assertNull(error);
//           assert(!deleted);
//           assertNull(modified);
//           assert(!conflict);
//         });
//       });
//     });

//     describe('versioning', () => {
//       it('deletes the item if the given version is current', () => {
//         store.delete('boris', '/photos/election', date, () => {
//           store.get('boris', '/photos/election', null, function (error, item) {
//             resume(() => { assertNull(item); });
//           });
//         });
//       });

//       it('does not delete the item if the given version is not current', () => {
//         store.delete('boris', '/photos/election', oldDate, () => {
//           store.get('boris', '/photos/election', null, function (error, item) {
//             resume(() => { assertEqual(buffer('hair'), item.value); });
//           });
//         });
//       });

//       it('returns true with no conflict if the given version is current', () => {
//         store.delete('boris', '/photos/election', date, function (error, deleted, modified, conflict) {
//           resume(() => {
//             assertNull(error);
//             assert(deleted);
//             assertEqual(date, modified);
//             assert(!conflict);
//           });
//         });
//       });

//       it('returns false with a conflict if the given version is not current', () => {
//         store.delete('boris', '/photos/election', oldDate, function (error, deleted, modified, conflict) {
//           resume(() => {
//             assertNull(error);
//             assert(!deleted);
//             assertNull(modified);
//             assert(conflict);
//           });
//         });
//       });
//     });
//   });
// });
// });
