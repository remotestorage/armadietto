const qs = require('querystring');
const url = require('url');
const accessStrings = { r: 'Read', rw: 'Read/write' };
const Controller = require('./base');
const { logRequest } = require('../logger');

class OAuth extends Controller {
  showForm (username) {
    if (this.redirectToSSL()) return;
    if (this.invalidUser(username)) return;
    if (this.invalidOAuthRequest()) return;

    this.renderHTML(200, 'auth.html', {
      title: 'Authorize',
      client_host: url.parse(this.params.redirect_uri).host,
      client_id: this.params.client_id,
      redirect_uri: this.params.redirect_uri,
      response_type: this.params.response_type,
      scope: this.params.scope || '',
      state: this.params.state || '',
      permissions: this.parseScope(this.params.scope || ''),
      username,
      access_strings: accessStrings
    });
  }

  async authenticate () {
    if (this.blockUnsecureRequest()) return;
    if (this.invalidUser(this.params.username)) return;
    if (this.invalidOAuthRequest()) return;

    const params = this.params;
    const username = params.username.split('@')[0];
    const permissions = this.parseScope(params.scope);

    if (params.deny) return this.error('access_denied', 'The user did not grant permission');

    try {
      await this.server._store.authenticate({ username, password: params.password });
      const token = await this.server._store.authorize(params.client_id, username, permissions);//, (error, token) => {
      const args = {
        access_token: token,
        token_type: 'bearer'
      };
      if (params.state !== undefined) args.state = params.state;
      this.redirect(args);
    } catch (error) {
      params.title = 'Authorization Failure';
      params.client_host = url.parse(params.redirect_uri).host;
      params.error = error.message;
      params.permissions = permissions;
      params.access_strings = accessStrings;
      params.state = params.state || '';

      this.renderHTML(401, 'auth.html', params);
    }
  }

  invalidOAuthRequest () {
    if (!this.params.client_id) return this.error('invalid_request', 'Required parameter "client_id" is missing');
    if (!this.params.response_type) return this.error('invalid_request', 'Required parameter "response_type" is missing');
    if (!this.params.scope) return this.error('invalid_scope', 'Parameter "scope" is invalid');

    if (!this.params.redirect_uri) return this.error('invalid_request', 'Required parameter "redirect_uri" is missing');
    const uri = url.parse(this.params.redirect_uri);
    if (!uri.protocol || !uri.hostname) return this.error('invalid_request', 'Parameter "redirect_uri" must be a valid URL');

    if (this.params.response_type !== 'token') {
      return this.error('unsupported_response_type', 'Response type "' + this.params.response_type + '" is not supported');
    }

    return false;
  }

  error (type, description) {
    this.redirect({ error: type, error_description: description },
        `${this.params.username} ${description} ${this.params.client_id}`);
    return true;
  }

  redirect (args, logNote) {
    const hash = qs.stringify(args);
    if (this.params.redirect_uri) {
      const location = this.params.redirect_uri + '#' + hash;
      this.response.writeHead(302, { Location: location });
      this.response.end();
      if (logNote) {
        logRequest(this.request, this.params.username || '-', 302, 0, logNote, 'warning');
      } else {
        logRequest(this.request, this.params.username || '-', 302, 0, '-> ' + this.params.redirect_uri, 'notice');
      }
    } else {
      this.response.writeHead(400, { 'Content-Type': 'text/plain' });
      this.response.end(hash);
      logRequest(this.request, this.params.username || '-', 400, hash.length, 'no redirect_uri');
    }
  }

  // OAuth.prototype.accessStrings = {r: 'Read', rw: 'Read/write'};
  parseScope (scope) {
    const parts = scope.split(/\s+/);
    const scopes = {};
    let pieces;

    for (let i = 0, n = parts.length; i < n; i++) {
      pieces = parts[i].split(':');
      pieces[0] = pieces[0].replace(/(.)\/*$/, '$1');
      if (pieces[0] === 'root') pieces[0] = '/';

      scopes[pieces[0]] = (pieces.length > 1)
        ? pieces.slice(1).join(':').split('')
        : ['r', 'w'];
    }
    return scopes;
  }
}

module.exports = OAuth;
