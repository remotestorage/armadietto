/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));

module.exports.shouldCreateDeleteAndReadAccounts = function () {
  describe('createUser', function () {
    before(function () {
      this.username1 = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    });

    after(async function () {
      await this.store.deleteUser(this.username1);
    });

    it('rejects a user with too short a name', async function () {
      const params = { username: 'a', email: 'a@b.c', password: 'swordfish' };
      await expect(this.store.createUser(params)).to.be.rejectedWith(Error, 'Username must be at least 2 characters');
    });

    it('rejects creating a user with illegal characters in username', async function () {
      const params = { username: 'a+a', email: 'a@b.c', password: 'swordfish' };
      await expect(this.store.createUser(params)).to.be.rejectedWith(Error, 'only contain lowercase letters, numbers, dots, dashes and underscores');
    });

    it('rejects creating a user with bad email', async function () {
      const params = { username: 'a1a', email: 'a@b', password: 'swordfish' };
      await expect(this.store.createUser(params)).to.be.rejectedWith(Error, 'Email is not valid');
    });

    it('rejects creating a user without password', async function () {
      const params = { username: 'a2a', email: 'a@b.c', password: '' };
      await expect(this.store.createUser(params)).to.be.rejectedWith(Error, 'Password must not be blank');
    });

    it('creates a user & rejects creating a new user with an existing name', async function () {
      const params1 = { username: this.username1, email: 'a@b.c', password: 'swordfish' };
      await expect(this.store.createUser(params1)).to.eventually.eql(this.username1);
      const params2 = { username: this.username1, email: 'd@e.f', password: 'iloveyou' };
      await expect(this.store.createUser(params2)).to.be.rejectedWith(Error, 'is already taken');
    });
  });

  describe('deleteUser', function () {
    before(function () {
      this.username2 = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    });

    after(async function () {
      await this.store.deleteUser(this.username2);
    });

    it('deletes a user', async function () {
      const params = { username: this.username2, email: 'a@b.c', password: 'swordfish' };
      await expect(this.store.createUser(params)).to.eventually.eql(this.username2);
      const result = await this.store.deleteUser(this.username2);
      await expect(result?.[0]).to.be.greaterThanOrEqual(2);
      await expect(result?.[1]).to.equal(0);
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
      return this.store.createUser(goodParams);
    });

    after(async function () {
      return this.store.deleteUser(goodParams.username);
    });

    it('throws a cagey error if the user does not exist', async function () {
      const badParams = { username: 'nonexisting', email: 'g@h.i', password: 'dictionary' };
      await expect(this.store.authenticate(badParams)).to.be.rejectedWith('Password and username do not match');
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
