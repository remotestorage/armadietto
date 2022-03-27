const ejs = require('ejs');
const fs = require('fs');
const qs = require('querystring');
const url = require('url');
const core = require('../stores/core');
const path = require('path');
const { getLogger, logRequest } = require('../logger');

const viewDir = path.join(__dirname, '..', 'views');

class Controller {
  constructor (server, request, response) {
    this.server = server;
    this.request = request;
    this.response = response;

    const contentType = (request.headers['content-type'] || '').split(/\s*;\s*/)[0];
    if (contentType === 'application/x-www-form-urlencoded') {
      this.params = qs.parse(request.body);
    } else {
      this.params = url.parse(request.url, true).query || {};
    }
  }

  blockUnsecureRequest () {
    if (this.request.secure || !this.server._forceSSL) return false;
    this.response.writeHead(400, { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload' });
    this.response.end();
    logRequest(this.request, '-', 400, 0, 'blocked insecure');
    return true;
  }

  getHost () {
    return this.request.headers['x-forwarded-host'] || this.request.headers.host || '';
  }

  redirectToSSL () {
    if (this.request.secure || !this.server._forceSSL) return false;

    let host = this.getHost().split(':')[0];
    const port = (this.server._options.https || {}).port;

    if (port) host += ':' + port;

    this.response.writeHead(302, {
      Location: 'https://' + host + this.request.url,
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload'
    });
    this.response.end();
    logRequest(this.request, '-', 302, 0, '-> https://' + host + this.request.url);
    return true;
  }

  invalidUser (username) {
    if (core.isValidUsername(username)) return false;
    this.response.writeHead(400, { 'Content-Type': 'text/plain' });
    this.response.end();
    logRequest(this.request, username, 400, 0, 'invalid user');
    return true;
  }

  readFile (path) {
    if (this.server._fileCache[path]) return this.server._fileCache[path];
    try {
      const content = fs.readFileSync(path);
      if (this.server._cacheViews) this.server._fileCache[path] = content;
      return content;
    } catch (e) {
      if (e.code !== 'ENOENT') {
        getLogger().error('readFile:', e);
      }
      return null;
    }
  }

  renderXRD (file, locals) {
    const response = this.response;
    const template = this.readFile(path.join(viewDir, file));

    locals = locals || {};
    const body = Buffer.from(ejs.render(template.toString(), locals));

    response.writeHead(200, {
      'Access-Control-Allow-Origin': this.request.headers.origin || '*',
      'Content-Length': body.length,
      'Content-Type': 'application/xrd+xml'
    });
    response.write(body);
    response.end();
    logRequest(this.request, '-', 200, body.length);
  }

  renderJSON (data, contentType) {
    const body = Buffer.from(JSON.stringify(data, true, 2));

    this.response.writeHead(200, {
      'Access-Control-Allow-Origin': this.request.headers.origin || '*',
      'Content-Length': body.length,
      'Content-Type': 'application/' + contentType
    });
    this.response.write(body);
    this.response.end();
    logRequest(this.request, '-', 200, body.length);
  }

  renderHTML (status, file, locals = {}) {
    const response = this.response;
    const layout = this.readFile(path.join(viewDir, '/layout.html')).toString();
    const body = this.readFile(path.join(viewDir, file)).toString();

    locals.basePath = this.server._basePath;

    const globals = {
      scheme: this.request.secure ? 'https' : 'http',
      host: this.getHost(),
      basePath: this.server._basePath,
      title: locals.title || '',
      signup: this.server._allow.signup,
      body: ejs.render(body, locals)
    };
    const html = Buffer.from(ejs.render(layout, globals));

    const headers = {
      'Content-Length': html.length,
      'Content-Type': 'text/html; charset=utf8',
      'Content-Security-Policy': "sandbox allow-scripts allow-forms allow-same-origin; default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; object-src 'none'; child-src 'none'; connect-src 'none'; base-uri 'self'; frame-ancestors 'none';",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    };
    if (this.server._forceSSL) {
      headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload';
    }
    response.writeHead(status, headers);
    response.end(html);
    const username = locals.username || (locals.params && locals.params.username) || '-';
    logRequest(this.request, username, status, html.length, locals.message || locals.error);
  }

  errorPage (status, message) {
    this.renderHTML(status, 'error.html', { title: 'Error', status, message });
  }
}

module.exports = Controller;
