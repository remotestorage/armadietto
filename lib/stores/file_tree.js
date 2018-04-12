const core = require('./core');
const fs = require('fs');
const {promisify} = require('util');
const lockfile = require('lockfile');
const mkdirp = promisify(require('mkdirp'));
const path = require('path');
// const rename = require('./rename');

// promisify
const lock = promisify(lockfile.lock);
const unlock = promisify(lockfile.unlock);
const unlink = promisify(fs.unlink);

const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);
const utimes = promisify(fs.utimes);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const rename = promisify(fs.rename);

class FileTree {
  constructor (options) {
    this._dir = path.resolve(options.path);
    // this._renameLegacyFiles();
  }

  async _lock (username) {
    const lockPath = path.join(this._dir, username.substr(0, 2), username, '.lock');
    await mkdirp(path.dirname(lockPath));
    try {
      await lock(lockPath);
    } catch (e) {
      await unlock(lockPath);
      await lock(lockPath);
    }
  }

  async _unlock (username) {
    const lockPath = path.join(this._dir, username.substr(0, 2), username, '.lock');
    await unlock(lockPath);
  }

  authPath (username) {
    return path.join(username.substr(0, 2), username, 'auth.json');
  }

  dataPath (username, pathname) {
    const query = core.parsePath(pathname).slice(1);
    const filename = query.pop() || '';
    const dir = query.map(q => q.replace(/\/$/, '~')).join('/');

    return path.join(username.substr(0, 2), username, 'storage', dir, filename);
  }

  metaPath (username, pathname) {
    const query = core.parsePath(pathname).slice(1);
    const filename = query.pop() || '';
    const dir = query.map(q => q.replace(/\/$/, '~')).join('/');
    return path.join(username.substr(0, 2), username, 'storage', dir, '.~' + filename);
  }

  dirname (username, pathname) {
    return path.dirname(path.join(this._dir, this.dataPath(username, pathname + '_')));
  }

  async childPaths (username, path) {
    const entries = await readdir(this.dirname(username, path));
    return entries.sort();
  }

  async touch (dirname, modified = Date.now()) {
    const statInfo = await stat(dirname);
    await utimes(dirname, statInfo.atime, modified);
  }

  async createUser (params) {
    const errors = core.validateUser(params);

    if (errors.length > 0) throw new Error(errors[0]);

    const userPath = this.authPath(params.username);
    const user = await this.readJson(userPath);
    if (user) {
      throw new Error('The username is already taken');
    }

    const hash = await core.hashPassword(params.password, null);
    const data = {email: params.email, password: hash};
    return this.writeFile(userPath, JSON.stringify(data, true, 2));
  }

  async readJson (path) {
    try {
      const { content } = await this.readFile(path);
      return content ? JSON.parse(content) : null;
    } catch (e) {
      return null;
    }
  }

  async authenticate (params) {
    const username = params.username || '';
    const user = await this.readJson(this.authPath(username));
    if (!user) throw new Error('Username not found');
    const key = user.password.key;
    const hash = await core.hashPassword(params.password, user.password);
    if (hash.key === key) return true;

    throw new Error('Incorrect password');
  }

  async authorize (clientId, username, permissions) {
    const userPath = this.authPath(username);
    const token = core.generateToken();
    let user = await this.readJson(userPath);
    let category;

    user.sessions = user.sessions || {};
    let session = user.sessions[token] = {clientId, permissions: {}};

    for (let scope in permissions) {
      category = scope.replace(/^\/?/, '/').replace(/\/?$/, '/');
      session.permissions[category] = {};
      for (var i = 0, n = permissions[scope].length; i < n; i++) {
        session.permissions[category][permissions[scope][i]] = true;
      }
    }

    await this.writeFile(userPath, JSON.stringify(user, true, 2));
    return token;
  }

  async revokeAccess (username, token) {
    const userPath = this.authPath(username);
    const user = await this.readJson(userPath);
    if (user && user.sessions) {
      delete user.sessions[token];
    }
    await this.writeFile(userPath, JSON.stringify(user, true, 2));
  }

  async permissions (username, token) {
    const userPath = this.authPath(username);
    const user = await this.readJson(userPath);
    if (!user) return {};
    const data = user.sessions;
    if (!data || !data[token]) return {};

    const permissions = data[token].permissions;
    if (!permissions) return {};
    let output = {};

    for (var category in permissions) { output[category] = Object.keys(permissions[category]).sort(); }

    return output;
  }

  error (message, status) {
    var error = new Error(message);
    error.status = status;
    return error;
  }

  _versionMatch (version, modified) {
    if (!version || !modified) return false;
    return version === modified;
  }

  async get (username, path, version) {
    const isdir = /\/$/.test(path);
    const dataPath = this.dataPath(username, path);
    const metaPath = this.metaPath(username, path);
    await this._lock(username);

    // dir listing
    if (isdir) {
      if (!fs.existsSync(this.dirname(username, path))) return {item: { children: [] }};
      const statInfo = await stat(this.dirname(username, path));
      const mtime = statInfo && statInfo.mtime.getTime();
      let entries = await this.childPaths(username, path);
      if (entries.length === 0) return this._unlock(username);

      entries = entries.filter(e => !/^\.~/.test(e));
      const listing = await Promise.all(entries.map(entry => this._getListing(username, path, entry)));
      await this._unlock(username);
      return {item: {children: listing}, modified: mtime};//, this._versionMatch(version, mtime));
    } else {
      const {content: blob, modified} = await this.readFile(dataPath);
      if (!blob) return { item: null };
      let item = await this.readJson(metaPath);// readJson(metaPath);
      item.modified = modified;
      // .toString('utf8');
      item.value = blob;
      await this._unlock(username);
      return { item };
    }
  }

  async _getListing (username, pathname, entry) {
    const fullPath = path.join(this.dirname(username, pathname), entry);
    try {
      const statInfo = await stat(fullPath);
      return {
        name: entry.replace(/~$/, '/'),
        modified: statInfo.mtime.getTime()
      };
    } catch (e) {
      return null;
    }
  }

  async put (username, pathname, type, value, version) {
    const query = core.parsePath(pathname);
    await this._lock(username);
    const dataPath = this.dataPath(username, pathname);
    const metaPath = this.metaPath(username, pathname);
    var exists;
    let {current, modified} = await this.getCurrentState(dataPath, version);
    if (!current) return this._unlock(username);
    try {
      await this.writeFile(metaPath,
        JSON.stringify({length: value.length, type: type}, true, 2));

      await this.writeFile(dataPath, value);

      // simplify
      await Promise.all(core.indexed(query).map((entry) => {
        const i = entry.index;
        this.touch(this.dirname(username, query.slice(0, i + 1).join('')));
      }));

      await this._unlock(username);
      return {created: !exists, modified};
    } catch (error) {
      await this._unlock(username);
      return {created: false};
    }
  }

  async delete (username, path, version) {
    await this._lock(username);
    const {exists, modified, conflict} = await this._delete(username, path, version);
    if (!exists || conflict) {
      await this._unlock(username);
      return {exists, conflict};
    }

    this._removeParents(username, path);
    await this._unlock(username);
    return {exists, modified};
  }

  async _delete (username, pathname, version) {
    const dataPath = this.dataPath(username, pathname);
    const metaPath = this.metaPath(username, pathname);

    const {current, modified} = this.getCurrentState(dataPath, version);
    if (!current) return {exists: false, modified: null, current: !current};
    await unlink(dataPath);
    await unlink(metaPath);
    return {modified};
  }

  async _removeParents (username, pathname) {
    const parents = core.parents(pathname);

    let dirname;
    for (let parent of parents) {
      dirname = this.dirname(username, parent);

      await new Promise((resolve) => {
        this.childPaths(username, parent, (entries) => {
          if (entries.length === 0) {
            fs.rmdir(dirname, resolve);
          } else {
            var modified = new Date();
            this.touch(dirname, modified.getTime(), resolve);
          }
        });
      });
    }
  }

  async readFile (filename) {
    const fullPath = path.join(this._dir, filename);
    let statInfo;
    try {
      statInfo = await stat(fullPath);
    } catch (e) {
      return {content: null};
    }
    const content = await readFile(fullPath);
    const modified = statInfo.mtime.getTime();
    return { content, modified };
  }

  async writeFile (filename, content) {
    const fullPath = path.join(this._dir, filename);

    let statInfo;
    try {
      statInfo = await stat(fullPath);
    } catch (e) {
      await mkdirp(path.dirname(fullPath));
    }

    await writeFile(fullPath, content);
    return {exists: !!statInfo, modified: statInfo && statInfo.mtime.getTime()};
  }

  async getCurrentState (filepath, version) {
    const fullPath = path.join(this._dir, filepath);
    if (!fs.existsSync(fullPath)) {
      if (!version || version === '*') return {current: true};
    }
    const statInfo = await stat(fullPath);
    const modified = statInfo && statInfo.mtime.getTime();
    if (!version) return { current: true, modified };
    if (version === '*') return {current: !modified};
    return { current: modified === version, modified };
  }

  _renameLegacyFiles () {
    const REWRITE_PATTERNS = [
      [/^\.([^~]*)\.(json|meta)$/, '.~$1'],
      [/^([^~]*)\.d$/, '$1~'],
      [/^([^~]*)\.blob$/, '$1']
    ];
    fs.readdir(this._dir, (error, entries) => {
      if (error) return;

      entries.forEach(entry => {
        fs.readdir(path.join(this._dir, entry), (error, users) => {
          if (error) return;

          users.forEach(async username => {
            await this._lock(username);
            const pathname = path.join(this._dir, entry, username, 'storage');
            rename(pathname, REWRITE_PATTERNS);
          });
        });
      });
    });
  }
}

module.exports = FileTree;
