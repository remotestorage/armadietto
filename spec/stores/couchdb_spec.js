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
        url: 'http://localhost:5984',
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
  });
}
