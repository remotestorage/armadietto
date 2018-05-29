const Controller = require('./base');

class Users extends Controller {
  showForm () {
    if (!this.server._allow.signup) return this.errorPage(403, 'Forbidden');
    if (this.redirectToSSL()) return;
    this.renderHTML(200, 'signup.html', {params: this.params, error: null});
  }

  async register () {
    if (!this.server._allow.signup) return this.errorPage(403, 'Forbidden');
    if (this.blockUnsecureRequest()) return;

    try {
      await this.server._store.createUser(this.params);
      this.renderHTML(201, 'signup-success.html', {params: this.params});
    } catch (error) {
      this.renderHTML(409, 'signup.html', {params: this.params, error});
    }
  }
}

module.exports = Users;
