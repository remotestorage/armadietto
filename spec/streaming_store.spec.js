/* eslint-env mocha, chai, node */

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));

module.exports.shouldStream = function () {
  it('rejects a user with too short a name', async function () {
    const params = { username: 'a', email: 'a@b.c', password: 'swordfish' };
    await expect(this.store.createUser(params)).to.be.rejectedWith(Error, 'Username must be at least 2 characters');
  });

  it('rejects creating a user with illegal characters in username', async function () {
    const params = { username: 'a+a', email: 'a@b.c', password: 'swordfish' };
    await expect(this.store.createUser(params)).to.be.rejectedWith(Error, 'only contain letters, numbers, dots, dashes and underscores');
  });

  it('rejects creating a user with bad email', async function () {
    const params = { username: 'a1a', email: 'a@b', password: 'swordfish' };
    await expect(this.store.createUser(params)).to.be.rejectedWith(Error, 'Email is not valid');
  });

  it('rejects creating a user without password', async function () {
    const params = { username: 'a2a', email: 'a@b.c', password: '' };
    await expect(this.store.createUser(params)).to.be.rejectedWith(Error, 'Password must not be blank');
  });

  it('rejects creating a new user with an existing name', async function () {
    const params1 = { username: this.username1, email: 'a@b.c', password: 'swordfish' };
    await expect(this.store.createUser(params1)).to.eventually.eql(this.username1);
    const params2 = { username: this.username1, email: 'd@e.f', password: 'iloveyou' };
    await expect(this.store.createUser(params2)).to.be.rejectedWith(Error, 'is already taken');
  });

  it('deletes a user', async function () {
    const params = { username: this.username2, email: 'a@b.c', password: 'swordfish' };
    await expect(this.store.createUser(params)).to.eventually.eql(this.username2);
    await expect(this.store.deleteUser(this.username2)).to.eventually.eql(0);
  });
};
