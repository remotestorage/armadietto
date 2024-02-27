/* eslint-env mocha, chai, node */

const { configureLogger } = require('../../lib/logger');
const Armadietto = require('../../lib/armadietto');
const { shouldCrudBlobs } = require('../storage.spec');
const chai = require('chai');
const expect = chai.expect;
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const spies = require('chai-spies');
chai.use(spies);
chai.use(require('chai-as-promised'));

/** This mock needs to implement conditionals, to test the code that generates responses */
const mockStore = {
  content: null,
  metadata: null,
  children: null,

  get (_username, _path, versions) {
    const content = this.content || '';
    const ETag = this.metadata?.ETag?.replace(/"/g, '');
    if (versions) { // If-None-Match presumed
      if (versions === this.metadata?.ETag) {
        return { versionMatch: true, item: { ETag } };
      } else {
        return {
          versionMatch: false,
          item: { value: content, 'Content-Type': this.metadata.contentType, ETag }
        };
      }
    } else { // unconditional GET
      if (this.children) {
        return {
          item: { ETag, items: this.children }
        };
      } else if (content) {
        return {
          item: {
            value: Buffer.from(content),
            'Content-Length': content?.length,
            ETag,
            'Content-Type': this.metadata?.contentType
          }
        };
      } else {
        return { item: undefined };
      }
    }
  },
  put (_username, _path, contentType, value, version) {
    if (version === '*') { // If-None-Match
      if (this.metadata?.ETag) { // file exists, so conflict
        return { conflict: true };
      }
    } else if (version) { // The method signature doesn't allow us to distinguish — file_store presumes this to be If-Match.
      if (version !== this.metadata?.ETag) {
        return { conflict: true, modified: this.metadata?.ETag.replace(/"/g, '') };
      }
    } // else unconditional
    const created = !this.metadata?.ETag;
    this.content = value.toString();
    const modified = `ETag|${this.content}`;
    this.metadata = { contentType, ETag: modified };
    this.children = null;
    return { created, modified };
  },
  delete (_username, _path, version) {
    if (version) { // The method signature doesn't allow us to distinguish — file_store presumes this to be If-Match.
      if (version !== this.metadata?.ETag) {
        return { conflict: true, deleted: false, modified: this.metadata?.ETag.replace(/"/g, '') };
      }
    } // else unconditional
    if (this.metadata?.ETag) {
      this.content = this.metadata = this.children = null;
      return { deleted: true, modified: this.metadata?.ETag.replace(/"/g, '') };
    } else {
      this.content = this.metadata = this.children = null;
      return { deleted: false };
    }
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

function del (app, path) {
  return chai.request(app).delete(path).set('Authorization', 'Bearer a_token');
}

describe('Storage (monolithic)', function () {
  before(function () {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['error'] });

    this.store = mockStore;
    this.app = new Armadietto({
      bare: true,
      store: this.store,
      http: { },
      logging: { stdout: [], log_dir: './test-log', log_files: ['debug'] }
    });
  });

  shouldCrudBlobs();

  describe('GET', function () {
    beforeEach(function () {
      sandbox.on(this.store, ['get']);
    });

    afterEach(function () {
      sandbox.restore();
    });

    describe('when a valid access token is used', function () {
      it('ask the store for an item conditionally based on If-None-Match', async function () {
        await chai.request(this.app).get('/storage/zebcoe/locog/seats')
          .set('Authorization', 'Bearer a_token')
          .set('If-None-Match', `"${modifiedTimestamp}"`).send();
        expect(this.store.get).to.have.been.called.with('zebcoe', '/locog/seats', `"${modifiedTimestamp}"`);
      });
    });
  });

  // describe('PUT', function () {
  //   beforeEach(function () {
  //     sandbox.on(this.store, ['put']);
  //   });
  //
  //   afterEach(function () {
  //     sandbox.restore();
  //   });
  //
  // })

  describe('DELETE', function () {
    beforeEach(function () {
      this.content = this.metadata = this.children = null;
      sandbox.on(this.store, ['delete']);
    });

    afterEach(function () {
      sandbox.restore();
    });

    describe('when the store says the item was deleted', function () {
      before(function () {
        this.store.delete = function () { return { deleted: true, modified: 1358121717830 }; };
      });

      it('returns an empty 200 response', async function () {
        const res = await del(this.app, '/storage/zebcoe/locog/seats');
        expect(res).to.have.status(200);
        expect(res.text).to.equal('');
      });
    });

    describe('when the store says there was a version conflict', function () {
      beforeEach(function () {
        this.store.delete = function () { return { deleted: false, modified: 1358121717830, conflict: true }; };
      });

      it('returns an empty 412 response', async function () {
        const res = await del(this.app, '/storage/zebcoe/locog/seats');
        expect(res).to.have.status(412);
        expect(res.text).to.equal('');
      });
    });
  });
});
