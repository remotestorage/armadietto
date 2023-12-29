const Controller = require('./base');

class Users extends Controller {
  showForm () {
    if (!this.server._allow.signup) return this.errorPage(403, 'Forbidden');
    if (this.redirectToSSL()) return;
    this.renderHTML(200, 'signup.html', { title: 'Signup', params: this.params, error: null });
  }

  async register () {
    if (!this.server._allow.signup) return this.errorPage(403, 'Forbidden');
    if (this.blockUnsecureRequest()) return;

    try {
      await this.server._store.createUser(this.params);
      this.renderHTML(201, 'signup-success.html', {
        title: 'Signup Success',
        params: this.params,
        host: this.getHost()
      });
    } catch (error) {
      this.renderHTML(409, 'signup.html', {
        title: 'Signup Failure',
        params: this.params,
        error,
        message: error.message
      });
    }
  }

  async showLoginForm () {
    if (this.redirectToSSL()) return;
    this.renderHTML(200, 'login.html', { params: this.params, error: null });
  }

  async showAccountPage () {
    if (this.blockUnsecureRequest()) return;

    const expandedPermissions = {
      'r': 'Read',
      'w': 'Write'
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
        params: { username: this.params.username },
        host: this.getHost(),
        sessions: authData.sessions ? Object.keys(authData.sessions).map(k => {
          return {
            clientId: authData.sessions[k].clientId,
            permissions: Object.keys(authData.sessions[k].permissions).map(folder => {
              return {
                folder: folder,
                permissions: Object.keys(authData.sessions[k].permissions[folder]).filter(perm => {
                  return authData.sessions[k].permissions[folder][perm];
                }).map(v => expandedPermissions[v])
              };
            })
          };
        }) : []
      });
    } catch (error) {
      this.renderHTML(409, 'login.html', { params: this.params, error });
    }
  }
}

module.exports = Users;
