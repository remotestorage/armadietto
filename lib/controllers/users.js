const Controller = require('./base')

class Users extends Controller {
  showForm () {
    if (!this.server._allow.signup) return this.errorPage(403, 'Forbidden')
    if (this.redirectToSSL()) return
    this.renderHTML(200, 'signup.html', {params: this.params, error: null})
  }

  register () {
    if (!this.server._allow.signup) return this.errorPage(403, 'Forbidden')
    if (this.blockUnsecureRequest()) return

    this.server._store.createUser(this.params, error => {
      if (error) {
        this.renderHTML(409, 'signup.html', {params: this.params, error: error})
      } else {
        this.renderHTML(201, 'signup-success.html', {params: this.params})
      }
    })
  }
}

module.exports = Users
