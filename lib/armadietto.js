const domain = require('domain')
const fs     = require('fs')
const http   = require('http')
const https  = require('https')
const url    = require('url');

const Assets    = require('./controllers/assets')
const OAuth     = require('./controllers/oauth')
const Storage   = require('./controllers/storage')
const Users     = require('./controllers/users')
const WebFinger = require('./controllers/web_finger');

const DEFAULT_HOST = '0.0.0.0'
const SSL_CIPHERS  = 'ECDHE-RSA-AES256-SHA384:AES256-SHA256:RC4-SHA:RC4:HIGH:!MD5:!aNULL:!EDH:!AESGCM'
const SSL_OPTIONS  = require('constants').SSL_OP_CIPHER_SERVER_PREFERENCE;

class armadietto {
  constructor(options) {
    this._options = options;
    this._store = options.store;
    this._forceSSL = options.https && options.https.force;
    this._fileCache = {};
    this._allow = options.allow || {};
    this._cacheViews = options.cacheViews !== false;
    this._httpServer = null;
    this._httpsServer = null;
    this.init()
      .catch((e) => { throw e });
  }

  async init() {
    if (this._options.http) {
      this._httpServer = http.createServer(this.handler);
    }

    if (this._options.https && this._options.https.port) {
      let ca = null;
      const key = await fs.readFile(this._options.https.key);
      const cert = await fs.readFile(this._options.https.cert);
      if (this._options.https.ca) {
        ca = await fs.readFile(this._options.https.ca);
      }
      const sslOptions = {
        key: key,
        cert: cert,
        ciphers: SSL_CIPHERS,
        secureOptions: SSL_OPTIONS,
        ca: ca,
      };

      this._httpsServer = https.createServer(sslOptions, this.handler);
    }
  }

  handler(req, res) {
    let d = domain.create()
      .add(req)
      .add(res)
      .on('error', (err) => {
        new Assets(this, req, res).errorPage(500, err.message);
      });

    d.run(() => {
      this.handle(req, res);
    });
  }

  boot() {
    if (this._httpServer) {
      this._httpServer.listen(this._options.http.port, this._options.http.host || DEFAULT_HOST);
    }

    if (this._httpsServer) {
      this._httpsServer.listen(this._options.https.port, this._options.https.host || DEFAULT_HOST);
    }
  }

  stop() {
    if (this._httpServer) this._httpServer.close();
    if (this._httpsServer) this._httpsServer.close();
  }

  handle(req, res) {
    if (process.env.DEBUG) console.log(request.method, request.url, request.headers);

    let body = new Buffer(0);

    req.on('data', (chunk) => {
      const buffer = new Buffer(body.length + chunk.length);
      body.copy(buffer);
      chunk.copy(buffer, body.length);
      body = buffer;
    });

    req.on('end', () => {
      req.buffer = body;
      req.body = body.toString('utf8');
      this.dispatch(req, res);
    });
  }

  dispatch(req, res) {
    const method = req.method.toUpperCase();
    const uri = url.parse(req.url, true);
    let match;

    req.secure = this.isSecureRequest(req);

    if (/(^|\/)\.\.(\/|$)/.test(uri.pathname)) {
      res.writeHead(400, {'Access-Control-Allow-Origin': req.headers.origin || '*'});
      return res.end();
    }

    if (method === 'GET') {
      match = uri.pathname.match(/^\/assets\/([^\/]+)$/);
      if (match)
        return new Assets(this, req, res).serve(match[1]);

      match = uri.pathname.match(/^\/\.well-known\/(host-meta|webfinger)(\.[a-z]+)?$/);
      if (match)
        return new WebFinger(this, req, res).hostMeta(match[1], match[2]);

      match = uri.pathname.match(/^\/webfinger\/(jrd|xrd)$/);
      if (match)
        return new WebFinger(this, req, res).account(match[1]);

      match = uri.pathname.match(/^\/oauth\/(.*)$/);
      if (match)
        return new OAuth(this, req, res).showForm(decodeURIComponent(match[1]));
    }

    if (method === 'POST' && uri.pathname === '/oauth')
      return new OAuth(this, req, res).authenticate();

    if (uri.pathname === '/signup') {
      var users = new Users(this, req, res);
      if (method === 'GET') return users.showForm();
      if (method === 'POST') return users.register();
    }

    match = uri.pathname.match(/^\/storage\/([^\/]+)(.*)$/);
    if (match) {
      const username = decodeURIComponent(match[1]).split('@')[0];
      const path = match[2];
      const storage = new Storage(this, req, res, username, path);

      if (!Storage.VALID_NAME.test(username) || !Storage.VALID_PATH.test(path)) {
        res.writeHead(400, {'Access-Control-Allow-Origin': req.headers.origin || '*'});
        return res.end();
      }

      if (method === 'OPTIONS') return storage.options();
      if (method === 'GET') return storage.get();
      if (method === 'PUT') return storage.put();
      if (method === 'DELETE') return storage.delete();
    }

    new Assets(this, req, res).errorPage(404, 'Not found');
  }

  isSecureRequest(r) {
    return (r.connection && r.connection.authorized !== undefined)
      || (r.socket && r.socket.secure)
      || (r.headers['x-forwarded-ssl'] === 'on')
      || (r.headers['x-forwarded-scheme'] === 'https')
      || (r.headers['x-forwarded-proto'] === 'https');
  }
}

module.exports = armadietto;
module.exports.FileTree = require('./stores/file_tree');
module.exports.Redis = require('./stores/redis');
