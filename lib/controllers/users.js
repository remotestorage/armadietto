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
      });
    }
  }
}

module.exports = Users;
