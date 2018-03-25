const async = require('async')
const core = require('./core')
const fs = require('fs')
const lockfile = require('lockfile')
const mkdirp = require('mkdirp')
const path = require('path')
const rename = require('./rename')

class FileTree {
  constructor (options) {
    this._dir = path.resolve(options.path)
    this._renameLegacyFiles()
  }

  _lock (username, callback) {
    const lockPath = path.join(this._dir, username.substr(0, 2), username, '.lock')

    mkdirp(path.dirname(lockPath), () => {
      lockfile.lock(lockPath, {wait: 10000}, (error) => {
        if (error) { return lockfile.unlock(lockPath, () => { this._lock(username, callback) }) }

        callback(() => lockfile.unlockSync(lockPath))
      })
    })
  }

  authPath (username) {
    return path.join(username.substr(0, 2), username, 'auth.json')
  }

  dataPath (username, pathname) {
    const query = core.parsePath(pathname).slice(1)
    const filename = query.pop() || ''
    const dir = query.map(q => q.replace(/\/$/, '~')).join('/')

    return path.join(username.substr(0, 2), username, 'storage', dir, filename)
  }

  metaPath (username, pathname) {
    const query = core.parsePath(pathname).slice(1)
    const filename = query.pop() || ''
    const dir = query.map(q => q.replace(/\/$/, '~')).join('/')

    return path.join(username.substr(0, 2), username, 'storage', dir, '.~' + filename)
  }

  dirname (username, pathname) {
    return path.dirname(path.join(this._dir, this.dataPath(username, pathname + '_')))
  }

  childPaths (username, path, callback) {
    fs.readdir(this.dirname(username, path), (error, entries) => {
      callback(error ? [] : entries.sort())
    })
  }

  touch (dirname, modified, callback) {
    fs.stat(dirname, (error, stat) => {
      if (error) return callback(error)
      fs.utimes(dirname, stat.atime.getTime() / 1000, modified / 1000, callback)
    })
  }

  createUser (params, callback) {
    const errors = core.validateUser(params)

    if (errors.length > 0) return callback(errors[0])

    const userPath = this.authPath(params.username)
    this.writeFile(userPath, (error, json, write) => {
      if (json) {
        return write(null, () => {
          callback(new Error('The username is already taken'))
        })
      }

      core.hashPassword(params.password, null, (error, hash) => {
        const data = {email: params.email, password: hash}
        write(JSON.stringify(data, true, 2), callback)
      })
    })
  }

  authenticate (params, callback) {
    const username = params.username || ''
    this.readFile(this.authPath(username), (error, json) => {
      if (error) return callback(new Error('Username not found'))

      const user = JSON.parse(json)
      const key = user.password.key

      core.hashPassword(params.password, user.password, (error, hash) => {
        if (hash.key === key) { callback(null) } else { callback(new Error('Incorrect password')) }
      })
    })
  }

  authorize (clientId, username, permissions, callback) {
    this.writeFile(this.authPath(username), (error, json, write) => {
      if (error) return callback(error)

      const user = JSON.parse(json)
      const token = core.generateToken()
      let session
      let category

      user.sessions = user.sessions || {}
      session = user.sessions[token] = {clientId: clientId, permissions: {}}

      for (var scope in permissions) {
        category = scope.replace(/^\/?/, '/').replace(/\/?$/, '/')
        session.permissions[category] = {}
        for (var i = 0, n = permissions[scope].length; i < n; i++) {
          session.permissions[category][permissions[scope][i]] = true
        }
      }

      write(JSON.stringify(user, true, 2), (error) => {
        if (error) { callback(error) } else { callback(null, token) }
      })
    })
  }

  revokeAccess (username, token, callback) {
    callback = callback || function () {}
    this.writeFile(this.authPath(username), (error, json, write) => {
      if (error) return callback(error)
      var user = JSON.parse(json)
      if (user.sessions) delete user.sessions[token]
      write(JSON.stringify(user, true, 2), callback)
    })
  }

  permissions (username, token, callback) {
    this.readFile(this.authPath(username), (error, json) => {
      if (error) return callback(null, {})
      var data = JSON.parse(json).sessions
      if (!data || !data[token]) return callback(null, {})

      const permissions = data[token].permissions
      let output = {}

      for (var category in permissions) { output[category] = Object.keys(permissions[category]).sort() }

      return callback(null, output)
    })
  }

  error (message, status) {
    var error = new Error(message)
    error.status = status
    return error
  }

  _versionMatch (version, modified) {
    if (!version || !modified) return false
    return version === modified
  }

  get (username, path, version, callback) {
    const isdir = /\/$/.test(path)
    const dataPath = this.dataPath(username, path)
    const metaPath = this.metaPath(username, path)

    this._lock(username, release => {
      if (isdir) {
        fs.stat(this.dirname(username, path), (error, stat) => {
          var mtime = stat && new Date(stat.mtime.getTime()).getTime()
          this.childPaths(username, path, entries => {
            if (entries.length === 0) {
              release()
              return callback(null, null)
            }
            entries = entries.filter(e => !/^\.~/.test(e))
            async.map(entries, (entry, callback) => {
              this._getListing(username, path, entry, callback)
            }, (error, listing) => {
              release()
              callback(null, {children: listing, modified: mtime}, this._versionMatch(version, mtime))
            })
          })
        })
      } else {
        this.readFile(dataPath, (error, blob, modified) => {
          this.readFile(metaPath, (error, json, _) => {
            if (error) {
              release()
              return callback(null, null)
            }
            var record = JSON.parse(json)
            record.modified = modified
            record.value = blob
            release()
            callback(null, record, this._versionMatch(version, modified))
          })
        })
      }
    })
  }

  _getListing (username, pathname, entry, callback) {
    const fullPath = path.join(this.dirname(username, pathname), entry)
    fs.stat(fullPath, (error, stat) => {
      callback(error, {
        name: entry.replace(/~$/, '/'),
        modified: new Date(stat.mtime.getTime()).getTime()
      })
    })
  }

  put (username, pathname, type, value, version, callback) {
    const query = core.parsePath(pathname)

    this._lock(username, release => {
      const dataPath = path.join(this._dir, this.dataPath(username, pathname))
      const metaPath = path.join(this._dir, this.metaPath(username, pathname))

      this.getCurrentState(dataPath, version, (error, current) => {
        if (error || !current) {
          release()
          return callback(error, null, null, true)
        }
        async.waterfall([
          (next) => {
            this.writeBlob(metaPath, JSON.stringify({length: value.length, type: type}, true, 2), next)
          },
          (exists, modified, next) => {
            this.writeBlob(dataPath, value, next)
          },
          (exists, modified, next) => {
            async.forEach(core.indexed(query), (entry, done) => {
              const i = entry.index
              this.touch(this.dirname(username, query.slice(0, i + 1).join('')), modified, done)
            }, () => {
              next(null, exists, modified)
            })
          }
        ], (error, exists, modified) => {
          release()
          callback(error, !exists, modified)
        })
      })
    })
  }

  delete (username, path, version, callback) {
    this._lock(username, release => {
      this._delete(username, path, version, (exists, modified, conflict) => {
        if (!exists || conflict) {
          release()
          return callback(null, exists, null, conflict)
        }

        this._removeParents(username, path, () => {
          release()
          callback(null, true, modified)
        })
      })
    })
  }

  _delete (username, pathname, version, callback) {
    const dataPath = path.join(this._dir, this.dataPath(username, pathname))
    const metaPath = path.join(this._dir, this.metaPath(username, pathname))

    this.getCurrentState(dataPath, version, (error, current, modified) => {
      if (error || !current) { return callback(false, null, !current) }

      fs.unlink(dataPath, (error) => {
        fs.unlink(metaPath, (error) => {
          callback(!error, modified)
        })
      })
    })
  }

  _removeParents (username, pathname, callback) {
    const parents = core.parents(pathname)

    async.forEachSeries(parents, (parent, done) => {
      var dirname = this.dirname(username, parent)

      this.childPaths(username, parent, (entries) => {
        if (entries.length === 0) {
          fs.rmdir(dirname, done)
        } else {
          var modified = new Date()
          this.touch(dirname, modified.getTime(), done)
        }
      })
    }, callback)
  }

  readFile (filename, callback) {
    var fullPath = path.join(this._dir, filename)
    fs.readFile(fullPath, (error, content) => {
      fs.stat(fullPath, (error, stat) => {
        var mtime = stat && new Date(stat.mtime.getTime()).getTime()
        callback(error, error ? null : content, error ? null : mtime)
      })
    })
  }

  writeFile (filename, writer) {
    const fullPath = path.join(this._dir, filename)

    fs.stat(fullPath, (error, stat) => {
      fs.readFile(fullPath, (error, content) => {
        writer(error, error ? null : content.toString(), (newContent, callback) => {
          if (newContent === null) return callback(null, !!stat)

          this.writeBlob(fullPath, newContent, error => {
            callback(error, !!stat)
          })
        })
      })
    })
  }

  getCurrentState (fullPath, version, callback) {
    fs.stat(fullPath, (error, stat) => {
      var mtime = stat && new Date(stat.mtime.getTime()).getTime()
      if (!version) return callback(null, true, mtime)
      if (version === '*') return callback(null, !mtime)
      if (error) return callback(null, false)
      callback(null, mtime === version, mtime)
    })
  }

  writeBlob (fullPath, newContent, callback) {
    var tmpPath = fullPath + '.tmp'

    mkdirp(path.dirname(fullPath), (error) => {
      fs.writeFile(tmpPath, newContent, (error) => {
        fs.stat(fullPath, (error, exists) => {
          fs.rename(tmpPath, fullPath, (error) => {
            fs.stat(fullPath, (e, stat) => {
              callback(error, !!exists, stat && new Date(stat.mtime.getTime()).getTime())
            })
          })
        })
      })
    })
  }

  _renameLegacyFiles () {
    const REWRITE_PATTERNS = [
      [/^\.([^~]*)\.(json|meta)$/, '.~$1'],
      [/^([^~]*)\.d$/, '$1~'],
      [/^([^~]*)\.blob$/, '$1']
    ]
    fs.readdir(this._dir, (error, entries) => {
      if (error) return

      entries.forEach(entry => {
        fs.readdir(path.join(this._dir, entry), (error, users) => {
          if (error) return

          users.forEach(username => {
            this._lock(username, release => {
              const pathname = path.join(this._dir, entry, username, 'storage')
              rename(pathname, REWRITE_PATTERNS, release)
            })
          })
        })
      })
    })
  }
}

module.exports = FileTree
