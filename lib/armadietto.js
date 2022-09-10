const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');

const { configureLogger, getLogger, logRequest } = require('./logger');
const Assets = require('./controllers/assets');
const OAuth = require('./controllers/oauth');
const Storage = require('./controllers/storage');
const Users = require('./controllers/users');
const WebFinger = require('./controllers/web_finger');
const process = require('process');

const DEFAULT_HOST = '0.0.0.0';
const SSL_CIPHERS = 'ECDHE-RSA-AES256-SHA384:AES256-SHA256:RC4-SHA:RC4:HIGH:!MD5:!aNULL:!EDH:!AESGCM';
const SSL_OPTIONS = require('crypto').constants.SSL_OP_CIPHER_SERVER_PREFERENCE;

class Armadietto {
  constructor (options) {
    this._options = options;
    this._store = options.store;
    this._forceSSL = options.https && options.https.force;
    this._fileCache = {};
    this._allow = options.allow || {};
    this._cacheViews = options.cacheViews !== false;
    this._basePath = options.basePath || '';
    this._server = null;
    configureLogger(options.logging);
    this.init();

    // These are the happy paths for shutdown.
    process.on('SIGINT', this.stop.bind(this));
    process.on('SIGTERM', this.stop.bind(this));

    // Without these listeners, these would not be logged, only sent to stdout or stderr.
    process.on('uncaughtExceptionMonitor', (err, origin) => {
      getLogger().crit(`${origin} ${err}`);
    });

    process.on('warning', (warning) => {
      getLogger().warning(`${warning.name} ${warning.message} ${warning.stack}`);
    });

    process.on('multipleResolves', (type, promise, reason) => {
      getLogger().debug(`multipleResolves ${type} “${reason}”`);
    });
  }

  init () {
    let _http = null;
    let _https = null;
    this._server = new Promise(resolve => {
      if (this._options.http) {
        _http = http.createServer(this.handle.bind(this));
        _http.on('clientError', this.clientError.bind(this));
      }

      if (this._options.https && this._options.https.port) {
        let ca = null;
        const key = fs.readFileSync(this._options.https.key);
        const cert = fs.readFileSync(this._options.https.cert);
        if (this._options.https.ca) {
          ca = fs.readFileSync(this._options.https.ca);
        }
        const sslOptions = {
          key,
          cert,
          ciphers: SSL_CIPHERS,
          secureOptions: SSL_OPTIONS,
          ca
        };

        _https = https.createServer(sslOptions, this.handle.bind(this));
        _https.on('clientError', this.clientError.bind(this));
      }

      resolve({
        _http,
        _https
      });
    });
  }

  clientError (err, socket) {
    let status, message;
    if (err.code === 'HPE_HEADER_OVERFLOW') {
      status = 431;
      message = 'Request Header Fields Too Large';
    } else {
      status = 400;
      message = 'Bad request';
    }

    if (err.code !== 'ECONNRESET' && socket.writable) {
      socket.end(`HTTP/1.1 ${status} ${message}\r\n\r\n`);
    }

    getLogger().warning(`${socket.address().address} n/a n/a ${status} ${message} ${err.toString()}`);
  }

  async boot () {
    if ((await this._server)._http) {
      (await this._server)._http.listen(this._options.http.port, this._options.http.host || DEFAULT_HOST);
    }

    if ((await this._server)._https) {
      (await this._server)._https.listen(this._options.https.port, this._options.https.host || DEFAULT_HOST);
    }
    getLogger().notice(`Accepting remoteStorage connections: http://${this._options.http.host || DEFAULT_HOST}:${this._options.http.port}/${this._basePath} ${(this._options.https && this._options.https.port) || ''}`);
  }

  /** gracefully stops and cleans up */
  async stop () {
    if ((await this._server)._http) (await this._server)._http.close();
    if ((await this._server)._https) (await this._server)._https.close();
    getLogger().notice('No longer accepting remoteStorage connections');
  }

  handle (req, res) {
    if (process.env.DEBUG) getLogger().debug(`${req.method} ${req.url} ${JSON.stringify(req.headers)}`);

    const body = [];

    req.on('data', chunk => body.push(chunk));

    req.on('end', () => {
      req.buffer = Buffer.concat(body);
      req.body = req.buffer.toString('utf8');
      this.dispatch(req, res)
        .catch(e => {
          logRequest(req, '-', 500, '-', 'DISPATCH ERROR: ' + e.toString());
        });
    });

    req.on('error', err => getLogger().error(err.stack));
  }

  async dispatch (req, res) {
    const method = req.method.toUpperCase();
    const uri = url.parse(req.url, true);

    const startBasePath = new RegExp('^/?' + this._basePath + '/?');
    let match;

    req.secure = this.isSecureRequest(req);

    if (!uri.pathname.match(startBasePath)) {
      res.writeHead(302, { Location: this._basePath });
      res.end();
      return logRequest(req, '-', 302, 0, '-> ' + this._basePath);
    }

    uri.pathname = uri.pathname.replace(startBasePath, '');

    if (/(^|\/)\.\.(\/|$)/.test(uri.pathname)) {
      res.writeHead(400, { 'Access-Control-Allow-Origin': req.headers.origin || '*' });
      res.end();
      return logRequest(req, '-', 400, 0, 'no relative paths');
    }

    if (method === 'GET') {
      match = uri.pathname.match(/^assets\/([^/]+)$/);
      if (match) {
        return new Assets(this, req, res).serve(match[1]);
      }
      if (uri.pathname === '') {
        return new Assets(this, req, res).renderHTML(200, 'index.html', { title: 'Welcome' });
      }

      match = uri.pathname.match(/^\.well-known\/(host-meta|webfinger)(\.[a-z]+)?$/);
      if (match) {
        return new WebFinger(this, req, res).hostMeta(match[1], match[2]);
      }

      match = uri.pathname.match(/^webfinger\/(jrd|xrd)$/);
      if (match) {
        return new WebFinger(this, req, res).account(match[1]);
      }

      match = uri.pathname.match(/^oauth\/(.*)$/);
      if (match) {
        return new OAuth(this, req, res).showForm(decodeURIComponent(match[1]));
      }
    }

    if (method === 'POST' && uri.pathname === 'oauth') {
      return new OAuth(this, req, res).authenticate();
    }

    if (uri.pathname === 'signup') {
      const users = new Users(this, req, res);
      if (method === 'GET') return users.showForm();
      if (method === 'POST') return users.register();
    }

    match = uri.pathname.match(/^storage\/([^/]+)(.*)$/);
    if (match) {
      const username = decodeURIComponent(match[1]).split('@')[0];
      const path = match[2];
      const storage = new Storage(this, req, res, username, path);

      if (!Storage.VALID_NAME.test(username) || !Storage.VALID_PATH.test(path)) {
        res.writeHead(400, { 'Access-Control-Allow-Origin': req.headers.origin || '*' });
        res.end();
        return logRequest(req, username, 400, 0, `user “${username}” or path “${path}” invalid`);
      }

      try {
        if (method === 'HEAD') await storage.get(true);
        if (method === 'OPTIONS') await storage.options();
        if (method === 'GET') await storage.get();
        if (method === 'PUT') await storage.put();
        if (method === 'DELETE') await storage.delete();
        return;
      } catch (e) {
        getLogger().error('Storage Error:', e);
      }
    }
    new Assets(this, req, res).errorPage(404, uri.pathname + ' Not found');
  }

  isSecureRequest (r) {
    return (r.connection && r.connection.authorized !== undefined) ||
      (r.socket && r.socket.secure) ||
      (r.headers['x-forwarded-ssl'] === 'on') ||
      (r.headers['x-forwarded-scheme'] === 'https') ||
      (r.headers['x-forwarded-proto'] === 'https');
  }
}

module.exports = Armadietto;
module.exports.FileTree = require('./stores/file_tree');
