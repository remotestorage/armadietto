const Controller = require('./base')
const core = require('../stores/core')

class Storage extends Controller {
  constructor (server, request, response, username, path) {
    super(server, request, response)
    this._username = username
    this._path = path

    if (this.request.headers.authorization) {
      this._token = decodeURIComponent(this.request.headers.authorization).split(/\s+/)[1]
    } else {
      this._token = this.params.access_token || this.params.oauth_token
    }

    this._headers = {
      'Access-Control-Allow-Origin': this.request.headers.origin || '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Type, ETag',
      'Cache-Control': 'no-cache, no-store'
    }
  }

  options () {
    this._headers['Access-Control-Allow-Methods'] = 'OPTIONS, GET, HEAD, PUT, DELETE'
    this._headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Length, Content-Type, If-Match, If-None-Match, Origin, X-Requested-With'
    this.response.writeHead(200, this._headers)
    this.response.end()
  }

  get () {
    const version = this.getVersion()
    this.checkToken('r', () => {
      this.server._store.get(this._username, this._path, version, (error, item, versionMatch) => {
        const status = error ? 500
          : item ? 200
            : 404

        if (item && item.children) {
          let listing = {}
          let n = item.children.length
          while (n--) listing[item.children[n].name] = item.children[n].modified.toString()
          this._headers['Content-Type'] = 'application/json'
          item.value = JSON.stringify(listing, true, 2)
        } else if (item) {
          this._headers['Content-Type'] = item.type || 'text/plain'
        }

        this.setVersion(item && item.modified)
        if (error) item = {value: error.message}

        if (versionMatch) {
          delete this._headers['Content-Type']
          this.response.writeHead(304, this._headers)
          return this.response.end()
        }

        if (item) this._headers['Content-Length'] = item.value.length
        this.response.writeHead(status, this._headers)
        if (item) this.response.write(item.value)
        this.response.end()
      })
    })
  }

  put () {
    const value = this.request.buffer
    const type = this.request.headers['content-type'] || ''
    const version = this.getVersion()
    this.checkToken('w', () => {
      this.server._store.put(this._username, this._path, type, value, version, (error, created, modified, conflict) => {
        var status = error ? 500
          : conflict ? 412
            : created ? 201
              : 200

        this.setVersion(modified)
        if (error) this._headers['Content-Length'] = Buffer.from(error.message).length
        this.response.writeHead(status, this._headers)
        this.response.end(error ? error.message : '')
      })
    })
  }

  delete () {
    const version = this.getVersion()

    this.checkToken('w', () => {
      this.server._store.delete(this._username, this._path, version, (error, deleted, modified, conflict) => {
        var status = error ? 500
          : deleted ? 200
            : conflict ? 412
              : 404

        this.setVersion(modified)
        if (error) this._headers['Content-Length'] = Buffer.from(error.message).length
        this.response.writeHead(status, this._headers)
        this.response.end(error ? error.message : '')
      })
    })
  }

  checkToken (permission, callback) {
    if (this.server._forceSSL && !this.request.secure) {
      this.server._store.revokeAccess(this._username, this._token)
      return this.unauthorized(400, 'invalid_request')
    }

    const category = this._path.replace(/^\/public\//, '/')
    const parents = core.parents(category, true)
    const isdir = /\/$/.test(this._path)
    const isPublic = /^\/public\//.test(this._path)

    if (permission === 'r' && isPublic && !isdir) return callback()

    this.server._store.permissions(this._username, this._token, (error, permissions) => {
      if (!permissions) return this.unauthorized(401, 'invalid_token')
      var dir

      for (var i = 0, n = parents.length; i < n; i++) {
        dir = permissions[parents[i]]
        if (!dir || dir.indexOf(permission) < 0) continue

        if (permission === 'w' && isdir) {
          this.response.writeHead(400, this._headers)
          return this.response.end()
        } else {
          return callback()
        }
      }
      this.unauthorized(403, 'insufficient_scope')
    })
  }

  getVersion () {
    const headers = this.request.headers
    const ifMatch = headers['if-match']
    const ifNone = headers['if-none-match']

    if (ifMatch) return parseInt(ifMatch.match(/\d+/)[0], 10)
    if (ifNone) return ifNone === '*' ? '*' : parseInt(ifNone.match(/\d+/)[0], 10)

    return null
  }

  setVersion (timestamp) {
    if (!timestamp) return
    this._headers['ETag'] = '"' + timestamp.toString() + '"'
  }

  unauthorized (status, error) {
    var realm = this.getHost()
    this._headers['WWW-Authenticate'] = 'Bearer realm="' + realm + '" error="' + error + '"'
    this.response.writeHead(status, this._headers)
    this.response.end()
  }
}

Storage.VALID_PATH = core.VALID_PATH
Storage.VALID_NAME = core.VALID_NAME
module.exports = Storage
