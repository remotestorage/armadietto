/* eslint-env mocha, chai, node */
/* eslint no-unused-vars: ["warn", { "varsIgnorePattern": "^_", "argsIgnorePattern": "^_" }]  */
/* eslint-disable no-unused-expressions */

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));
const updateSessionPrivileges = require('../../lib/util/updateSessionPrivileges');

class MockSession {
  regenerate (callback) {
    for (const name of Object.keys(this)) {
      delete this[name];
    }
    callback(undefined);
  }
}

describe('updateSessionPrivileges', function () {
  describe('when isAdminLogin is false', function () {
    it('doesn\'t retain privileges user no longer holds', async function () {
      const session = new MockSession();
      session.privileges = { STORE: true, FOO: true };
      const user = { privileges: { FOO: true } };

      await updateSessionPrivileges({ session }, user, false);

      expect(session.privileges).to.deep.equal({ FOO: true });
    });

    it('adds STORE & doesn\'t add ADMIN nor OWNER', async function () {
      const session = new MockSession();
      session.privileges = { BAR: true };
      const user = { privileges: { STORE: true, ADMIN: true, OWNER: true } };

      await updateSessionPrivileges({ session }, user, false);

      expect(session.privileges).to.deep.equal({ STORE: true });
    });
  });

  describe('when isAdminLogin is true', function () {
    it('doesn\'t retain privileges user no longer holds', async function () {
      const session = new MockSession();
      session.privileges = { STORE: true, ADMIN: true };
      const user = { privileges: { STORE: true, OWNER: true } };

      await updateSessionPrivileges({ session }, user, true);

      expect(session.privileges).to.deep.equal({ STORE: true, OWNER: true });
    });

    it('adds STORE, ADMIN & OWNER', async function () {
      const session = new MockSession();
      session.privileges = { SPAM: true };
      const user = { privileges: { STORE: true, ADMIN: true, OWNER: true } };

      await updateSessionPrivileges({ session }, user, true);

      expect(session.privileges).to.deep.equal({ STORE: true, ADMIN: true, OWNER: true });
    });
  });
});
