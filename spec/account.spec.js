/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));

module.exports.shouldCreateDeleteAndReadAccounts = function () {
  describe('createUser', function () {
    before(function () {
      this.username = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    });

    after(async function () {
      this.timeout(10_000);
      await this.store.deleteUser(this.username, new Set());
    });

    it('rejects a user with too short a name', async function () {
      const params = { username: 'aa', email: 'a@b.c', password: 'swordfish' };
      const logNotes = new Set();
      await expect(this.store.createUser(params, logNotes)).to.be.rejectedWith(Error, /user\s?name/i);
    });

    it('rejects creating a user with illegal characters in username', async function () {
      const params = { username: this.username + '\\q', email: 'a@b.c', password: 'swordfish' };
      const logNotes = new Set();
      await expect(this.store.createUser(params, logNotes)).to.be.rejectedWith(Error, /user\s?name/i);
    });

    it('rejects creating a user with bad email', async function () {
      const params = { username: this.username + 'j', email: 'a@b', password: 'swordfish' };
      const logNotes = new Set();
      await expect(this.store.createUser(params, logNotes)).to.be.rejectedWith(Error, /email/i);
    });

    it('rejects creating a user without password', async function () {
      const params = { username: this.username + 'h', email: 'a@b.c', password: '' };
      const logNotes = new Set();
      await expect(this.store.createUser(params, logNotes)).to.be.rejectedWith(Error, /password/i);
    });

    it('creates a user & rejects creating a new user with an existing name', async function () {
      const params1 = { username: this.username, email: 'a@b.c', password: 'swordfish' };
      const logNotes1 = new Set();
      await expect(this.store.createUser(params1, logNotes1)).to.eventually.eql(this.username + this.USER_NAME_SUFFIX);
      const params2 = { username: this.username, email: 'd@e.f', password: 'iloveyou' };
      const logNotes2 = new Set();
      await expect(this.store.createUser(params2, logNotes2)).to.be.rejectedWith(Error, 'is already taken');
    });
  });

  describe('deleteUser', function () {
    before(function () {
      this.username2 = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
      this.username3 = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
      this.username4 = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    });

    it('deletes a user', async function () {
      this.timeout(10_000);
      const params = { username: this.username2, email: 'a@b.c', password: 'swordfish' };
      await expect(this.store.createUser(params, new Set())).to.eventually.eql(this.username2 + this.USER_NAME_SUFFIX);

      const logNotes = new Set();
      const result = await this.store.deleteUser(this.username2, logNotes);
      expect(result?.[0]).to.be.greaterThanOrEqual(2);
      expect(result?.[1]).to.equal(0);
      expect(result?.[2]).to.equal(1);
      expect(logNotes.size).to.equal(0);
    });

    it('returns normally when user deleted twice at the same time', async function () {
      this.timeout(10_000);
      const params = { username: this.username3, email: 'a@b.c', password: 'swordfish' };
      await expect(this.store.createUser(params, new Set())).to.eventually.eql(this.username3 + this.USER_NAME_SUFFIX);

      const logNotes = new Set();
      const results = await Promise.all(
        [this.store.deleteUser(this.username3, logNotes), this.store.deleteUser(this.username3, logNotes)]);
      expect(results[0]?.[0]).to.be.greaterThanOrEqual(0);
      expect(results[0]?.[1]).to.equal(0);
      expect(results[0]?.[2]).to.be.within(0, 1);
      expect(results[1]?.[0]).to.be.greaterThanOrEqual(0);
      expect(results[1]?.[1]).to.equal(0);
      expect(results[1]?.[2]).to.be.within(0, 1);
      expect(logNotes.size).to.equal(0);
    });

    it('returns normally when user doesn\'t exist', async function () {
      this.timeout(10_000);

      const logNotes = new Set();
      const result = await this.store.deleteUser(this.username4, logNotes);
      expect(result?.[0]).to.equal(0);
      expect(result?.[1]).to.equal(0);
      expect(result?.[2]).to.equal(0);
      expect(logNotes.size).to.equal(0);
    });
  });

  describe('authenticate', function () {
    let goodParams;

    before(async function () {
      goodParams = {
        username: 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER),
        email: 'g@h.i',
        password: 'dictionary'
      };
      return this.store.createUser(goodParams, new Set());
    });

    after(async function () {
      this.timeout(10_000);
      return this.store.deleteUser(goodParams.username, new Set());
    });

    it('throws a cagey error if the user does not exist', async function () {
      const badParams = { username: 'nonexisting', email: 'g@h.i', password: 'dictionary' };
      const logNotes = new Set();
      await expect(this.store.authenticate(badParams, logNotes)).to.be.rejectedWith('Password and username do not match');
      expect(Array.from(logNotes)).to.include('attempt to log in with nonexistent user “nonexisting”');
    });

    it('throws a cagey error for a wrong password for an existing user', async function () {
      const badPassword = Object.assign({}, goodParams, { password: 'wrong' });
      await expect(this.store.authenticate(badPassword)).to.be.rejectedWith('Password and username do not match');
    });

    it('resolves for a good user', async function () {
      await expect(this.store.authenticate(goodParams)).to.eventually.equal(true);
    });
  });
};
