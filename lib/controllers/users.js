const DISABLED_LOCALS = { title: 'Forbidden', message: 'Signing up is not allowed currently' };
const DISABLED_LOG_NOTE = 'signups disabled';
const Controller = require('./base');

class Users extends Controller {
  showForm () {
    if (!this.server._allow.signup) return this.errorPage(403, DISABLED_LOCALS, DISABLED_LOG_NOTE);
    if (this.redirectToSSL()) return;
    this.renderHTML(200, 'signup.html', { title: 'Signup', params: this.params, error: null });
  }

  async register () {
    if (!this.server._allow.signup) return this.errorPage(403, DISABLED_LOCALS, DISABLED_LOG_NOTE);
    if (this.blockUnsecureRequest()) return;

    try {
      await this.server._store.createUser(this.params);
      this.renderHTML(201, 'signup-success.html', {
        title: 'Signup Success',
        params: this.params,
        host: this.getHost()
      }, `created user '${this.params.username}' w/ email '${this.params.email}'`, 'notice');
    } catch (error) {
      this.renderHTML(409, 'signup.html', {
        title: 'Signup Failure',
        params: this.params,
        error,
        message: error.message
      }, `while signing up: ${error.message || error.code || error.name || error.toString()}`);
    }
  }

  async showLoginForm () {
    if (this.redirectToSSL()) return;
    this.renderHTML(200, 'login.html', { title: 'Login', params: this.params, error: null });
  }

  async showAccountPage () {
    if (this.blockUnsecureRequest()) return;

    const expandedPermissions = {
      r: 'Read',
      w: 'Write'
    };

    try {
      await this.server._store.authenticate(this.params);
      const authData = await this.server._store.readAuth(this.params.username);
      // this is a bit of a monster but it formats the somewhat unwieldy auth.json
      // for a user into something that looks like:
      // {
      //   "params": {"username": string},
      //   "host": string,
      //   "sessions: [
      //     "clientId": string,    <- the url for the app as per the spec
      //     "permissions": [
      //       {
      //         "folder": string,
      //         "permissions": ["Read", "Write"]    <- the permission array may contain one/both
      //       }
      //     ]
      //   ]
      // }
      //
      // We're doing this transform just to make it easier on the view side to
      // iterate over things.
      this.renderHTML(200, 'account.html', {
        title: 'Account',
        params: { username: this.params.username },
        host: this.getHost(),
        sessions: authData.sessions
          ? Object.values(authData.sessions).map(session => {
            return {
              clientId: session.clientId,
              appName: /https?:\/\/([a-zA-Z\d-]+)[.:$]/.exec(session.clientId)?.[1] || '',
              permissions: Object.entries(session.permissions).map(([folder, perms]) => {
                return {
                  folder,
                  permissions: Object.keys(perms).filter(perm => {
                    return perms[perm];
                  }).map(v => expandedPermissions[v])
                };
              })
            };
          })
          : []
      });
    } catch (error) {
      this.renderHTML(409, 'login.html', { title: 'Login', params: this.params, error },
        `while showing account: ${error.message || error.code || error.name || error.toString()}`);
    }
  }
}

module.exports = Users;
