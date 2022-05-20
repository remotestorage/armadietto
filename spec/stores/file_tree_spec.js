/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */
const path = require('path');
const rmrf = require('rimraf');
const FileTree = require('../../lib/stores/file_tree');
const { expect } = require('chai');
const { itBehavesLike } = require('bdd-lazy-var');
require('../store_spec');

describe('FileTree store', () => {
  const store = new FileTree({ path: path.join(__dirname, '/../../tmp/store') });
  after(() => {
    rmrf(path.join(__dirname, '/../../tmp/store'), () => {});
  });
  itBehavesLike('Stores', store);

  describe('storage methods', () => {
    before(async () => {
      try {
        await store.createUser({ username: 'boris', email: 'boris@example.com', password: 'zipwire' });
      } catch (err) {}
    });

    describe('put', () => {
      it('returns true with a timestamp when a new item is created', async () => {
        const before = new Date().getTime();
        const {
          created,
          modified
        } = await store.put('boris', '/photos/antani2', 'image/poster', Buffer.from('veribo'), null);
        const after = new Date().getTime();
        expect(created).to.be.true;
        expect(parseInt(modified)).to.be.lte(after).and.gte(before);
      });

      it('returns true with a timestamp when a new category is created', async () => {
        const before = new Date().getTime();
        const {
          created,
          modified,
          conflict
        } = await store.put('boris', '/documents/zipwire2', 'image/poster', Buffer.from('vertibo'), null);
        const after = new Date().getTime();
        expect(created).to.be.true;
        expect(parseInt(modified)).to.be.lte(after).and.gte(before);
        expect(!conflict).to.be.true;
      });
    });

    describe('get', () => {
      it('returns empty folder when document is retrieved as folder', async () => {
        await expect(store.put('boris', '/scope/fonts2', 'font/example', Buffer.from('fljadlkf'))).to.eventually.include({ created: true, conflict: false });
        const { item /*, isClash */ } = await store.get('boris', '/scope/fonts2/');
        expect(item.items).to.deep.equal({});
      });

      it('flags clash when folder is retrieved as document', async () => {
        await expect(store.put('boris', '/scope/some-folder2/sound', 'audio/example', Buffer.from('ldjaflkdsjfklds'))).to.eventually.include({ created: true, conflict: false });
        const { item, isClash } = await store.get('boris', '/scope/some-folder2');
        expect(item).to.be.null;
        expect(isClash).to.be.true;
      });
    });
  });
});
