const async = require('async')
const core = require('./core')
const redis = require('redis')

const DEFAULT_HOST = 'localhost'
const DEFAULT_PORT = 6379
const DEFAULT_DATABASE = 0

class RedisStore {
  constructor (options = {}) {
    this._options = options
    const host = this._options.host || DEFAULT_HOST
    const port = this._options.port || DEFAULT_PORT
    const db = this._options.database || DEFAULT_DATABASE
    const auth = this._options.password
    const socket = this._options.socket

    this._ns = this._options.namespace || ''

    this._redis = socket
      ? redis.createClient(socket, {no_ready_check: true})
      : redis.createClient(port, host, {no_ready_check: true})

    if (auth) this._redis.auth(auth)
    this._redis.select(db)
  }

  redisFor (username) {
    return this._redis // TODO: support sharding
  }

  authPath (username) {
    return this._ns + 'users:' + username + ':auth'
  }

  userPath (username) {
    return this._ns + 'users:' + username
  }

  permissionPath (username, token, category) {
    var prefix = this._ns + 'users:' + username
    if (token === undefined) return prefix + ':clients'
    if (category === undefined) return prefix + ':clients:' + token
    category = category.replace(/^\/?/, '/').replace(/\/?$/, '/')
    return prefix + ':clients:' + token + ':permissions:' + category
  };

  createUser (params, callback) {
    const errors = core.validateUser(params)
    const client = this.redisFor(params.username)

    if (errors.length > 0) return callback(errors[0])

    core.hashPassword(params.password, null, (error, hash) => {
      client.hsetnx(this.authPath(params.username), 'key', hash.key, (error, set) => {
        if (set === 0) return callback(new Error('The username is already taken'))

        const multi = client.multi()
        const command = [this.authPath(params.username)]

        for (var key in hash) {
          command.push(key)
          command.push(String(hash[key]))
        }

        multi.hset(this.userPath(params.username), 'email', params.email)
        multi.hmset.apply(multi, command)

        multi.exec(callback)
      })
    })
  }

  authenticate (params, callback) {
    const username = params.username || ''
    this.redisFor(username).hgetall(this.authPath(username), (error, hash) => {
      if (hash === null) return callback(new Error('Username not found'))

      const key = hash.key

      core.hashPassword(params.password, hash, (error, hash) => {
        if (hash.key === key) {
          callback(null)
        } else {
          callback(new Error('Incorrect password'))
        }
      })
    })
  }

  authorize (clientId, username, permissions, callback) {
    const client = this.redisFor(username)
    const token = core.generateToken()
    const multi = client.multi()

    multi.sadd(this.permissionPath(username), token)

    Object.keys(permissions).map((category, n) => {
      multi.set(this.permissionPath(username, token) + ':clientId', clientId)
      multi.sadd(this.permissionPath(username, token), category)
      permissions[category].forEach((perms, i) => {
        multi.sadd(this.permissionPath(username, token, category), perms)
      })
    })

    multi.exec(() => {
      callback(null, token)
    })
  };

  revokeAccess (username, token, callback) {
    callback = callback || function () {}

    const client = this.redisFor(username)

    client.smembers(this.permissionPath(username, token), (error, categories) => {
      if (error) return callback(error)

      var multi = client.multi()

      categories.forEach(dir => {
        multi.del(this.permissionPath(username, token, dir))
      })
      multi.del(this.permissionPath(username, token))

      multi.exec(callback)
    })
  }

  permissions (username, token, callback) {
    const output = {}
    const client = this.redisFor(username)

    client.smembers(this.permissionPath(username, token), (error, categories) => {
      Promise.all(categories.map((dir) => {
        return new Promise((resolve, reject) => {
          client.smembers(this.permissionPath(username, token, dir), (error, permissions) => {
            output[dir.replace(/^\/?/, '/').replace(/\/?$/, '/')] = permissions.sort()
            resolve()
          })
        })
      })).then(() => {
        callback(null, output)
      })
    })
  }

  clientForToken (username, token, callback) {
    this.redisFor(username).hget(this.authPath(username), 'key', (error, key) => {
      if (!key) return callback(new Error())
      var cipher = new Cipher(key)
      cipher.decrypt(token, callback)
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

  get (username, pathname, version, callback) {
    const isdir = /\/$/.test(pathname)
    const client = this.redisFor(username)

    var key = this._ns + 'users:' + username + ':data:' + pathname
    if (isdir) {
      this._lock(username, (release) => {
        client.hget(key, 'modified', (error, modified) => {
          modified = parseInt(modified, 10)
          client.smembers(key + ':children', (error, children) => {
            if (children.length === 0) {
              release()
              return callback(null, null)
            }
            Promise.all(children.sort().map((child) => {
              return new Promise((resolve, reject) => {
                client.hget(key + child, 'modified', (error, modified) => {
                  if (error) {
                    reject(error)
                  } else {
                    resolve({name: child, modified: parseInt(modified, 10)})
                  }
                })
              })
            })).then((listing) => {
              release()
              callback(null, {children: listing, modified: modified}, this._versionMatch(version, modified))
            }).catch((error) => {
              release()
              callback(error)
            })
          })
        })
      })
    } else {
      client.hgetall(key, (error, hash) => {
        if (hash) {
          hash.length = parseInt(hash.length, 10)
          hash.modified = parseInt(hash.modified, 10)
          hash.value = Buffer.from(hash.value, 'base64')
        }
        callback(error, hash, this._versionMatch(version, hash && hash.modified))
      })
    }
  }

  put (username, pathname, type, value, version, callback) {
    const query = core.parsePath(pathname)
    const filename = query.pop()
    const client = this.redisFor(username)
    const dataKey = this._ns + 'users:' + username + ':data:' + pathname

    this._lock(username, release => {
      this.getCurrentState(client, dataKey, version, (error, current, mtime) => {
        if (error || !current) {
          release()
          return callback(error, false, null, !current)
        }

        const modified = new Date().getTime().toString().replace(/...$/, '000')
        const multi = client.multi()

        core.indexed(query).forEach((q, i) => {
          var key = this._ns + 'users:' + username + ':data:' + query.slice(0, i + 1).join('')
          multi.hset(key, 'modified', modified)
          multi.sadd(key + ':children', query[i + 1] || filename)
        })

        multi.hmset(dataKey, {length: value.length, type: type, modified: modified, value: value.toString('base64')})

        multi.exec(error => {
          release()
          callback(error, !mtime, parseInt(modified, 10))
        })
      })
    })
  }

  delete (username, pathname, version, callback) {
    const query = core.parsePath(pathname)
    const parents = core.parents(pathname)
    const client = this.redisFor(username)
    const prefix = this._ns + 'users:' + username + ':data:'
    const dataKey = prefix + pathname

    this._lock(username, release => {
      this.getCurrentState(client, dataKey, version, async (error, current, mtime) => {
        if (error || !current) {
          release()
          return callback(error, false, null, !current)
        }

        try {
          const children = await new Promise((resolve, reject) => {
            Promise.all(parents.map((parent) => {
              return new Promise((resolve) => {
                client.smembers(prefix + parent + ':children', (error, child) => {
                  if (error) {
                    reject(error)
                  } else {
                    resolve(child)
                  }
                })
              })
            })).then((children) => {
              resolve(children)
            })
          })

          const [empty, remaining] = await new Promise((resolve) => {
            let empty = [],
              index = 0,
              remaining
  
            while (index < parents.length && children[index].length === 1) {
              empty.push(parents[index])
              index += 1
            }
            remaining = parents.slice(index)
            resolve([empty, remaining])
          })
  
          await new Promise((resolve) => {
            let multi = client.multi(),
              modified = new Date().getTime().toString().replace(/...$/, '000'),
              item
  
            if (remaining.length > 0) {
              item = query[query.length - empty.length - 1]
              multi.srem(prefix + remaining[0] + ':children', item)
            }

            remaining.forEach(function (dir) {
              multi.hset(prefix + dir, 'modified', modified)
            })

            empty.forEach(function (parent) {
              var key = prefix + parent
              multi.del(key)
              multi.del(key + ':children')
            })

            multi.del(dataKey)
            multi.exec(resolve)
          })

          release()
          callback(null, !!mtime, mtime)
        } catch (error) {
          release()
          callback(error, !!mtime, mtime)
        }
      })
    })
  }

  getCurrentState (client, dataKey, version, callback) {
    client.hget(dataKey, 'modified', (error, modified) => {
      if (error) return callback(error, !version, null)

      var mtime = modified && parseInt(modified, 10)
      if (!version) return callback(null, true, mtime)
      if (version === '*') return callback(null, !mtime)

      callback(null, mtime === version, mtime)
    })
  }

  _lock (username, callback) {
    const lockKey = this._ns + 'locks:' + username
    const currentTime = new Date().getTime()
    const expiry = currentTime + 10000 + 1
    const client = this.redisFor(username)

    function releaseLock () {
      if (new Date().getTime() < expiry) client.del(lockKey)
    }

    function retry () {
      setTimeout(() => { this._lock(username, callback) }, 100)
    }

    client.setnx(lockKey, expiry, (error, set) => {
      if (set === 1) return callback(releaseLock)

      client.get(lockKey, (error, timeout) => {
        if (!timeout) return retry()

        const lockTimeout = parseInt(timeout, 10)
        if (currentTime < lockTimeout) return retry()

        client.getset(lockKey, expiry, (error, oldValue) => {
          if (oldValue === timeout) { callback(releaseLock) } else { retry() }
        })
      })
    })
  }
}

module.exports = RedisStore
