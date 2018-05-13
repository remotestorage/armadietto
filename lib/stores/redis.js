const core = require('./core');
const Redis = require('ioredis');

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 6379;
const DEFAULT_DATABASE = 0;

function isEmpty (obj) {
  return (Object.keys(obj).length === 0);
}
class RedisStore {
  constructor (options = {}) {
    this._options = options;
    const host = this._options.host || DEFAULT_HOST;
    const port = this._options.port || DEFAULT_PORT;
    const db = this._options.database || DEFAULT_DATABASE;
    const password = this._options.password;
    const socket = this._options.socket;

    this._ns = this._options.namespace || '';
    this._redis = socket
      ? new Redis({path: socket, db, password})
      : new Redis({host, port, db, password});
  }

  redisFor (username) {
    return this._redis; // TODO: support sharding
  }

  authPath (username) {
    return this._ns + 'users:' + username + ':auth';
  }

  userPath (username) {
    return this._ns + 'users:' + username;
  }

  permissionPath (username, token, category) {
    var prefix = this._ns + 'users:' + username;
    if (token === undefined) return prefix + ':clients';
    if (category === undefined) return prefix + ':clients:' + token;
    category = category.replace(/^\/?/, '/').replace(/\/?$/, '/');
    return prefix + ':clients:' + token + ':permissions:' + category;
  }

  async createUser (params) {
    const errors = core.validateUser(params);
    if (errors.length > 0) throw new Error(errors[0]);
    const client = this.redisFor(params.username);

    const hash = await core.hashPassword(params.password, null);
    if (await client.hsetnx(this.authPath(params.username), 'key', hash.key) === 0) {
      throw new Error('The username is already taken');
    }

    const multi = client.multi();
    const command = [this.authPath(params.username)];

    for (let key in hash) {
      command.push(key);
      command.push(String(hash[key]));
    }

    multi.hset(this.userPath(params.username), 'email', params.email);
    multi.hmset.apply(multi, command);

    return multi.exec();
  }

  async authenticate (params) {
    const username = params.username || '';
    const password = await this.redisFor(username).hgetall(this.authPath(username));
    if (Object.keys(password).length === 0) throw new Error('Username not found');
    const key = password.key;
    const hash = await core.hashPassword(params.password, password);
    if (hash.key === key) return true;
    throw new Error('Incorrect password');
  }

  async authorize (clientId, username, permissions) {
    const client = this.redisFor(username);
    const token = core.generateToken();
    const multi = client.multi();

    multi.sadd(this.permissionPath(username), token);

    Object.keys(permissions).map((category, n) => {
      multi.set(this.permissionPath(username, token) + ':clientId', clientId);
      multi.sadd(this.permissionPath(username, token), category);
      permissions[category].forEach((perms, i) => {
        multi.sadd(this.permissionPath(username, token, category), perms);
      });
    });

    await multi.exec();
    return token;
  }

  async revokeAccess (username, token) {
    const client = this.redisFor(username);

    const categories = await client.smembers(this.permissionPath(username, token));
    var multi = client.multi();

    categories.forEach(dir => {
      multi.del(this.permissionPath(username, token, dir));
    });
    multi.del(this.permissionPath(username, token));

    multi.exec();
  }

  async permissions (username, token) {
    const output = {};
    const client = this.redisFor(username);

    const categories = await client.smembers(this.permissionPath(username, token));
    return Promise.all(categories.map(async dir => {
      const permissions = await client.smembers(this.permissionPath(username, token, dir));
      output[dir.replace(/^\/?/, '/').replace(/\/?$/, '/')] = permissions.sort();
    })).then(() => output);
  }

  _versionMatch (version, modified) {
    if (!version || !modified) return false;
    return version === modified;
  }

  async get (username, pathname, version) {
    const isdir = /\/$/.test(pathname);
    const client = this.redisFor(username);

    var key = this._ns + 'users:' + username + ':data:' + pathname;
    if (isdir) {
      await this._lock(username);
      let modified = await client.hget(key, 'modified');
      modified = parseInt(modified, 10);
      const children = await client.smembers(key + ':children');
      if (children.length === 0) {
        await this._unlock(username);
        return {item: {items: {}}};
      }
      return Promise.all(children.sort().map((child) => {
        return client.hget(key + child, 'modified')
          .then(modified => ({name: child, modified: parseInt(modified, 10)}));
      })).then((listing) => {
        this._unlock(username);
        return {item: { items: listing, modified }, versionMatch: this._versionMatch(version, modified)};
      }).catch((error) => {
        this._unlock(username);
        throw new Error(error);
      });
    } else {
      const item = await client.hgetall(key);
      if (isEmpty(item)) return { item: null };
      item.length = parseInt(item.length, 10);
      item.modified = parseInt(item.modified, 10);
      item.value = Buffer.from(item.value, 'base64');
      return {item, versionMatch: this._versionMatch(version, item && item.modified)};
    }
  }

  async put (username, pathname, type, value, version) {
    const query = core.parsePath(pathname);
    const filename = query.pop();
    const client = this.redisFor(username);
    const dataKey = this._ns + 'users:' + username + ':data:' + pathname;

    await this._lock(username);
    const {current} = await this.getCurrentState(client, dataKey, version);
    if (!current) {
      this._unlock(username);
      return {conflict: true};
    }

    const modified = new Date().getTime().toString(); // .replace(/...$/, '000');
    const multi = client.multi();

    core.indexed(query).forEach((q, i) => {
      var key = this._ns + 'users:' + username + ':data:' + query.slice(0, i + 1).join('');
      multi.hset(key, 'modified', modified);
      multi.sadd(key + ':children', query[i + 1] || filename);
    });

    multi.hmset(dataKey, {length: value.length, type: type, modified: modified, value: value.toString('base64')});

    await multi.exec();
    this._unlock(username);
    return {created: true, modified};
  }

  delete (username, pathname, version, callback) {
    const query = core.parsePath(pathname);
    const parents = core.parents(pathname);
    const client = this.redisFor(username);
    const prefix = this._ns + 'users:' + username + ':data:';
    const dataKey = prefix + pathname;

    this._lock(username, release => {
      this.getCurrentState(client, dataKey, version, async (error, current, mtime) => {
        if (error || !current) {
          release();
          return callback(error, false, null, !current);
        }

        try {
          const children = await new Promise((resolve, reject) => {
            Promise.all(parents.map((parent) => {
              return new Promise((resolve) => {
                client.smembers(prefix + parent + ':children', (error, child) => {
                  if (error) {
                    reject(error);
                  } else {
                    resolve(child);
                  }
                });
              });
            })).then((children) => {
              resolve(children);
            });
          });

          const [empty, remaining] = await new Promise((resolve) => {
            let empty = [],
              index = 0,
              remaining;

            while (index < parents.length && children[index].length === 1) {
              empty.push(parents[index]);
              index += 1;
            }
            remaining = parents.slice(index);
            resolve([empty, remaining]);
          });

          await new Promise((resolve) => {
            let multi = client.multi(),
              modified = new Date().getTime().toString().replace(/...$/, '000'),
              item;

            if (remaining.length > 0) {
              item = query[query.length - empty.length - 1];
              multi.srem(prefix + remaining[0] + ':children', item);
            }

            remaining.forEach(function (dir) {
              multi.hset(prefix + dir, 'modified', modified);
            });

            empty.forEach(function (parent) {
              var key = prefix + parent;
              multi.del(key);
              multi.del(key + ':children');
            });

            multi.del(dataKey);
            multi.exec(resolve);
          });

          release();
          callback(null, !!mtime, mtime);
        } catch (error) {
          release();
          callback(error, !!mtime, mtime);
        }
      });
    });
  }

  async getCurrentState (client, dataKey, version) {
    const modified = await client.hget(dataKey, 'modified');
    // if (error) return callback(error, !version, null);

    const mtime = modified && parseInt(modified, 10);
    if (!version) return { current: true, modified: mtime };
    if (version === '*') return {current: !mtime};

    return ({current: mtime === version, modified: mtime});
  }

  async _lock (username) {
    const lockKey = this._ns + 'locks:' + username;
    const currentTime = new Date().getTime();
    const expiry = currentTime + 10000 + 1;
    const client = this.redisFor(username);

    function retry () {
      setTimeout(async () => { await this._lock(username); }, 100);
    }

    if (await client.setnx(lockKey, expiry) === 1) return;

    const timeout = client.get(lockKey);
    if (!timeout) return retry();

    const lockTimeout = parseInt(timeout, 10);
    if (currentTime < lockTimeout) return retry();

    const oldValue = await client.getset(lockKey, expiry);
    if (oldValue !== timeout) retry();
  }

  async _unlock (username) {
    const lockKey = this._ns + 'locks:' + username;
    const client = this.redisFor(username);
    client.del(lockKey);
  }
}

module.exports = RedisStore;
