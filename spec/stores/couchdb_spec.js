/* To run these tests, start CouchDB and create the file spec/couchDbOptions.json
   Set userAdmin and passwordAdmin in spec/couchDbOptions.json.
   Set url as well *unless* CouchDB is accepting connections on the default
   http://localhost:5984,
 */

/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */
const { expect } = require('chai');
const { itBehavesLike } = require('bdd-lazy-var');
require('../store_spec');
const CouchDB = require('../../lib/stores/couchdb');
const nanoConnect = require('nano');
const { readFileSync } = require('fs');
const { subject, get, def } = require('bdd-lazy-var/getter');

let options;
try {
  // noinspection JSCheckFunctionSignatures
  options = JSON.parse(readFileSync('spec/couchDbOptions.json', 'utf8'));
} catch (err) {
  console.log('Not testing CouchDB store');
}

if (options) {
  describe('CouchDB store', function () {
    this.timeout(20_000);

    before(async () => {
      const nano = nanoConnect({
        url: options.url || 'http://localhost:5984',
        requestDefaults: { jar: true }
      });
      await nano.auth(options.userAdmin, options.passwordAdmin);

      const users = nano.use('_users');
      for (const username of ['zebcoe', 'słychać', '和谐', 'boris', 'natasha', 'aaron']) {
        try {
          const id = 'org.couchdb.user:' + username;
          const user = await users.get(id);
          console.log('destroying', id);
          await users.destroy(id, user._rev);
        } catch (err) {
          if (err.statusCode !== 404) {
            console.error(`while destroying ${username}:`, err.statusCode, err.description, err.url);
          }
        }
      }
    });

    const store = new CouchDB(options);

    after(() => {
    });

    itBehavesLike('Stores', store);

    describe('createUser', () => {
      subject('user', () => store.createUser(get.params));

      describe('with non-ASCII name', () => {
        def('params', { username: 'słychać', email: 'słychać@example.com', password: 'słychać' });
        it('returns no errors', () => expect(get.user).to.be.fulfilled);
      });

      describe('with CJK name', () => {
        def('params', { username: '和谐', email: '和谐@example.com', password: '和谐' });
        it('returns no errors', () => expect(get.user).to.be.fulfilled);
      });
    });

    describe('storage methods', () => {
      describe('get', () => {
        it('flags clash when document is retrieved as folder', async () => {
          await expect(store.put('słychać', '/scope/fonts2', 'font/example', Buffer.from('fljadlkf'))).to.eventually.include({
            created: true,
            conflict: false
          });
          const { item, isClash } = await store.get('słychać', '/scope/fonts2/');
          expect(item).to.be.null;
          expect(isClash).to.be.true;
        });

        it('returns empty document when attachment is missing', async () => {
          const { created, modified, conflict } = await store.put('słychać', '/scope/folder/document', 'text/plain', Buffer.from('I\'d rather have newspapers without government, than government without newspapers'), null);
          expect(created).to.be.ok;
          expect(Boolean(conflict)).to.equal(false);

          const nano = nanoConnect({
            url: 'http://localhost:5984',
            requestDefaults: { jar: true }
          });
          await nano.auth(options.userAdmin, options.passwordAdmin);
          const dbName = 'userdb-' + Buffer.from('słychać').toString('hex');
          const db = nano.use(dbName);
          await db.attachment.destroy('/scope/folder/document', 'content', { rev: modified });

          const { item } = await store.get('słychać', '/scope/folder/document', modified);
          expect(item.ETag).to.be.a('string');
          expect(item.ETag).to.be.ok;
          expect(item['Content-Length']).to.equal(0);
          expect(item['Content-Type']).to.equal('application/octet-stream');
          expect(item['Last-Modified']).to.be.a('string');
          expect(Date.parse(item['Last-Modified'])).to.be.greaterThan(0);
          expect(item.value.length).to.equal(0);
          expect(item).to.be.an('object').that.has.all.keys('ETag', 'Content-Type', 'Content-Length', 'Last-Modified', 'value');
        });
      });

      describe('delete', () => {
        it('deletes item missing attachment without passing version', async () => {
          const { created, modified, conflict } = await store.put('słychać', '/scope/folder/something', 'text/plain', Buffer.from('fnord'), null);
          expect(created).to.be.ok;
          expect(Boolean(conflict)).to.equal(false);

          const nano = nanoConnect({
            url: 'http://localhost:5984',
            requestDefaults: { jar: true }
          });
          await nano.auth(options.userAdmin, options.passwordAdmin);
          const dbName = 'userdb-' + Buffer.from('słychać').toString('hex');
          const db = nano.use(dbName);
          await db.attachment.destroy('/scope/folder/something', 'content', { rev: modified });

          const { deleted, conflict: conflict2 } = await store.delete('słychać', '/scope/folder/something');
          expect(deleted).to.be.true;
          expect(Boolean(conflict2)).to.be.false;
        });
      });
    });
  });
}
