/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */

const chai = require('chai');
const widelyCompatibleId = require('../lib/util/widelyCompatibleId');
const NoSuchUserError = require('../lib/util/NoSuchUserError');
const expect = chai.expect;
chai.use(require('chai-as-promised'));

module.exports.shouldCreateDeleteAndReadAccounts = function () {
  describe('createUser', function () {
    before(function () {
      this.usernameAccount = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    });

    after(async function () {
      if (this.userIdAccount) {
        this.timeout(10_000);
        await this.accountMgr.deleteUser(this.userIdAccount, new Set());
      }
    });

    it('rejects a user with control characters in username', async function () {
      const params = { username: 'a\n1', contactURL: 'a@b.c' };
      const logNotes = new Set();
      await expect(this.accountMgr.createUser(params, logNotes)).to.be.rejectedWith(Error, /\busername\b.*\bcharacter/i);
    });

    it('rejects creating a user with bad contactURL', async function () {
      const params = { username: this.usernameAccount + 'j', contactURL: 'a@b' };
      const logNotes = new Set();
      await expect(this.accountMgr.createUser(params, logNotes)).to.be.rejectedWith(Error, /URL\b/i);
    });

    it('creates a user & rejects creating a new user with an existing username', async function () {
      const params1 = { username: this.usernameAccount, contactURL: 'a@b.cc' };
      const logNotes1 = new Set();
      const user = await this.accountMgr.createUser(params1, logNotes1);
      this.userIdAccount = user.username;
      expect(user.username).to.match(/^[0-9a-z.-]{10,63}$/);
      expect(user).to.have.property('username', this.usernameAccount);
      expect(user).to.have.property('contactURL', 'mailto:' + params1.contactURL);

      const params2 = { username: this.usernameAccount, contactURL: '2' + params1.contactURL };
      const logNotes2 = new Set();
      await expect(this.accountMgr.createUser(params2, logNotes2)).to.be.rejectedWith(Error, 'is already taken');
    });
  });

  describe('getUser', function () {
    it('should throw NoSuchUserError if user doesn\'t exist', async function () {
      const novelUsername = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);

      await expect(this.accountMgr.getUser(novelUsername, new Set())).to.be.rejectedWith(NoSuchUserError);
    });
  });

  describe('updateUser', function () {
    it('should throw NoSuchUserError if user doesn\'t exist', async function () {
      const novelUsername = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
      const novelUser = { username: novelUsername, contactURL: 'j@kk.ll' };

      await expect(this.accountMgr.updateUser(novelUser, new Set())).to.be.rejectedWith(NoSuchUserError);
    });
  });

  describe('listUsers', function () {
    before(function () {
      this.usernameAccountList1 = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
      this.usernameAccountList2 = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    });

    after(async function () {
      await this.accountMgr.deleteUser(this.user1?.username, new Set());
      await this.accountMgr.deleteUser(this.user2?.username, new Set());
    });

    it('should list users', async function () {
      this.timeout(10_000);
      const params1 = { username: this.usernameAccountList1, contactURL: 'mailto:d@ef.gh' };
      this.user1 = await this.accountMgr.createUser(params1, new Set());
      const params2 = { username: this.usernameAccountList2, contactURL: 'mailto:i@jk.lm' };
      this.user2 = await this.accountMgr.createUser(params2, new Set());

      const logNotes = new Set();
      const users = await this.accountMgr.listUsers(logNotes);
      expect(users).to.have.length.greaterThanOrEqual(2);
      const first = users.find(user => user.username === params1.username);
      expect(first).to.have.property('contactURL', params1.contactURL);
      const second = users.find(user => user.username === params2.username);
      expect(second).to.have.property('contactURL', params2.contactURL);
    });
  });

  describe('deleteUser', function () {
    before(function () {
      this.usernameAccount2 = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
      this.usernameAccount3 = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    });

    after(async function () {
      this.timeout(10_000);
      if (this.user2?.username) {
        await this.accountMgr.deleteUser(this.user2.username, new Set());
      }
      if (this.user3?.username) {
        await this.accountMgr.deleteUser(this.user3.username, new Set());
      }
    });

    it('deletes a user', async function () {
      this.timeout(10_000);
      const params = { username: this.usernameAccount2, contactURL: 'a@b.cc' };
      this.user2 = await this.accountMgr.createUser(params, new Set());

      const logNotes = new Set();
      const result = await this.accountMgr.deleteUser(this.user2.username, logNotes);
      expect(result?.[0]).to.be.greaterThanOrEqual(1);
      expect(result?.[1]).to.equal(0);
      expect(result?.[2]).to.equal(1);
      expect(logNotes.size).to.equal(1);
    });

    it('returns normally when user deleted twice at the same time', async function () {
      this.timeout(10_000);
      const params = { username: this.usernameAccount3, contactURL: 'b@c.dd' };
      this.user3 = await this.accountMgr.createUser(params, new Set());

      const logNotes = new Set();
      const results = await Promise.all(
        [this.accountMgr.deleteUser(this.user3.username, logNotes), this.accountMgr.deleteUser(this.user3.username, logNotes)]);
      expect(results[0]?.[0]).to.be.within(0, 1); // at most 1 blob
      expect(results[0]?.[1]).to.equal(0); // no errors
      expect(results[0]?.[2]).to.be.within(0, 1); // at most 1 pass
      expect(results[1]?.[0]).to.be.within(0, 1); // at most 1 blob
      expect(results[1]?.[1]).to.equal(0); // no errors
      expect(results[1]?.[2]).to.be.within(0, 1); // at most 1 pass
      expect(logNotes.size).to.equal(2); // success note from each call
    });

    it('returns normally when user doesn\'t exist', async function () {
      this.timeout(10_000);

      const logNotes = new Set();
      const result = await this.accountMgr.deleteUser(widelyCompatibleId(64), logNotes);
      expect(result?.[0]).to.equal(0);
      expect(result?.[1]).to.equal(0);
      expect(result?.[2]).to.equal(0);
      expect(logNotes.size).to.equal(1); // success note
    });
  });
};
