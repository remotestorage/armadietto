/* eslint-env mocha, chai, node */
const path = require('path');
const rmrf = require('rimraf');
const chai = require('chai');
const expect = chai.expect;
const FileTree = require('../../lib/stores/file_tree');

describe('FileTree store lockfree get', async () => {
  const store = new FileTree({ path: path.join(__dirname, '/../../tmp/store'), lock_timeout_ms: 1000 });

  before((done) => {
    (async () => {
      rmrf(path.join(__dirname, '/../../tmp/store'), () => {});
      await store.createUser({ username: 'boris', email: 'boris@example.com', password: 'zipwire' });
      done();
    })();
  });

  store.__readMeta = store.readMeta;

  after((done) => {
    (async () => {
      rmrf(path.join(__dirname, '/../../tmp/store'), () => {});
      done();
    })();
  });

  const getReadMetaInterrupted = (numberInterruptions) => {
    let callNum = 0;
    store.readMeta = async (username, pathname, isdir) => {
      const metadata = await store.__readMeta(username, pathname, isdir);
      if (callNum < numberInterruptions) {
        metadata.ETag = `${callNum}`;
        metadata.items.zipwire.ETag = `${callNum}`;
      }
      callNum++;
      return metadata;
    };
  };

  it('returns the value in the response', async () => {
    await store.put('boris', '/photos/zipwire', 'image/poster', Buffer.from('vertibo'), null);
    const { item } = await store.get('boris', '/photos/zipwire', null);
    expect(item.value).to.be.deep.equal(Buffer.from('vertibo'));
  });

  it('returns the value in the response after one interruption', async () => {
    await store.put('boris', '/photos/zipwire', 'image/poster', Buffer.from('vertibo'), null);

    getReadMetaInterrupted(1);

    const { item } = await store.get('boris', '/photos/zipwire', null);
    expect(item.value).to.be.deep.equal(Buffer.from('vertibo'));
  });

  it('returns the value in the response after two interruption', async () => {
    await store.put('boris', '/photos/zipwire', 'image/poster', Buffer.from('vertibo'), null);

    getReadMetaInterrupted(3);

    const { item } = await store.get('boris', '/photos/zipwire', null);
    expect(item.value).to.be.deep.equal(Buffer.from('vertibo'));
  });

  it('gets exception after three interruption', async () => {
    await store.put('boris', '/photos/zipwire', 'image/poster', Buffer.from('vertibo'), null);

    getReadMetaInterrupted(50);

    try {
      await store.get('boris', '/photos/zipwire', null);
    } catch (e) {
      expect(e.message).to.be.equal('ETag mismatch');
    }
  });
});
