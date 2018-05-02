const core = require('./core');
const fs = require('fs');
const {promisify} = require('util');
const lockfile = require('lockfile');
const mkdirp = promisify(require('mkdirp'));
const path = require('path');

// promisify
const lock = promisify(lockfile.lock);
const unlock = promisify(lockfile.unlock);
const unlink = promisify(fs.unlink);

const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);
const utimes = promisify(fs.utimes);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
// const rename = promisify(fs.rename);

class FileTree {
  constructor (options) {
    this._dir = path.resolve(options.path);
    // this._renameLegacyFiles();
  }

  async _lock (username) {
    const lockPath = path.join(this._dir, username.substr(0, 2), username, '.lock');
    // await mkdirp(path.dirname(lockPath));
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

  _authPath (username) {
    return this._resolvePath(username, 'auth.json');
  }

  _metaPath (username, pathname, isdir = false) {
    let p = this.dataPath(username, pathname);
    p = !isdir ? path.dirname(p) : p;
    return path.join(p, '.~meta');
  }

  readAuth (username) {
    return this.readJson(this._authPath(username));
  }

  async readMeta (username, pathname, isdir) {
    let metaData = await this.readJson(this._metaPath(username, pathname, isdir));
    if (!metaData) metaData = { items: {} };
    return metaData;
  }

  _resolvePath (username, pathname) {
    return path.join(this._dir, username.substr(0, 2), username, pathname);
  }

  dataPath (username, pathname) {
    return this._resolvePath(username, 'storage/' + pathname);
  }

  async childPaths (username, pathname) {
    const entries = await readdir(path.dirname(this.dataPath(username, pathname)));
    return entries.sort();
  }

  async touch (dirname, modified = Date.now()) {
    const statInfo = await stat(dirname);
    return utimes(dirname, statInfo.atime, modified);
  }

  async createUser (params) {
    const errors = core.validateUser(params);
    if (errors.length > 0) throw new Error(errors[0]);

    const username = params.username;
    const authPath = this._authPath(username);

    const user = await this.readAuth(username);
    if (user) throw new Error('The username is already taken');

    const hash = await core.hashPassword(params.password, null);
    const data = {email: params.email, password: hash};
    return this.writeFile(authPath, JSON.stringify(data, true, 2));
  }

  async readJson (path) {
    try {
      const content = await readFile(path);
      return content ? JSON.parse(content) : null;
    } catch (e) {
      return null;
    }
  }

  async authenticate (params) {
    const username = params.username || '';
    const user = await this.readAuth(username);
    if (!user) throw new Error('Username not found');
    const key = user.password.key;
    const hash = await core.hashPassword(params.password, user.password);
    if (hash.key === key) return true;

    throw new Error('Incorrect password');
  }

  async authorize (clientId, username, permissions) {
    const token = core.generateToken();
    let user = await this.readAuth(username);
    let category;

    user.sessions = user.sessions || {};
    let session = user.sessions[token] = {clientId, permissions: {}};

    // use lodash
    for (let scope in permissions) {
      category = scope.replace(/^\/?/, '/').replace(/\/?$/, '/');
      session.permissions[category] = {};
      for (var i = 0, n = permissions[scope].length; i < n; i++) {
        session.permissions[category][permissions[scope][i]] = true;
      }
    }

    await this.writeFile(this._authPath(username),
      JSON.stringify(user, true, 2));

    return token;
  }

  async revokeAccess (username, token) {
    const user = await this.readAuth(username);

    if (user && user.sessions) {
      delete user.sessions[token];
    }
    await this.writeFile(this._authPath(username), JSON.stringify(user, true, 2));
  }

  async permissions (username, token) {
    const user = await this.readAuth(username);
    if (!user) return {};
    const data = user.sessions;
    if (!data || !data[token]) return {};

    const permissions = data[token].permissions;
    if (!permissions) return {};
    let output = {};

    for (var category in permissions) { output[category] = Object.keys(permissions[category]).sort(); }

    return output;
  }

  _versionMatch (versions, modified) {
    if (!versions || !modified) return false;
    return versions.filter(version => modified === version.trim().replace(/"/g, ''));
  }

  async get (username, pathname, versions, head = false) {
    versions = versions && versions.split(',');
    const isdir = /\/$/.test(pathname);
    const filename = path.basename(pathname) + (isdir ? '/' : '');
    const dataPath = this.dataPath(username, pathname);
    let metaData = await this.readMeta(username, pathname, isdir);
    await this._lock(username);
    let item = {};

    if (metaData && isdir && this._versionMatch(versions, metaData.ETag)) {
      return {versionMatch: true};
    }
    if (metaData && metaData.items && metaData.items[filename] &&
      this._versionMatch(versions, metaData.items[filename].ETag)) {
      return {versionMatch: true};
    }
    // dir listing
    if (isdir) {
      if (!fs.existsSync(path.dirname(username, pathname))) return {item: { items: {} }};
      await this._unlock(username);
      return { item: metaData };
    } else {
      const {content: blob} = head ? '' : await this.readFile(dataPath);
      if (blob === null || !metaData.items[filename]) {
        await this._unlock(username);
        return { item: null };
      }
      metaData = metaData.items[filename];
      item.ETag = metaData.ETag.toString();
      item['Content-Type'] = metaData['Content-Type'];
      item['Content-Length'] = metaData['Content-Length'];
      item.value = blob;
      await this._unlock(username);
      return { item };
    }
  }

  async put (username, pathname, type, value, version) {
    await this._lock(username);
    const dataPath = this.dataPath(username, pathname);
    const metaPath = this._metaPath(username, pathname);
    const filename = path.basename(pathname);
    const {current, isDir} = await this.getCurrentState(dataPath, version);
    if (!current) {
      await this._unlock(username);
      return {conflict: true};
    }

    // check if something in this path is a file already
    const parents = core.parents(pathname, false);
    let dirConflicts = await Promise.all(parents.map(async parent => {
      const dirname = this.dataPath(username, parent).replace(/\/$/, '');
      if (!fs.existsSync(dirname)) return false;
      const statInfo = await stat(dirname);
      if (!statInfo.isDirectory()) {
        return true;
      }
      return false;
    }));
    dirConflicts = dirConflicts.reduce((tot, dir) => tot || dir);
    if (isDir || dirConflicts) {
      await this._unlock(username);
      return {created: false, isDir: true};
    }
    const metaData = await this.readMeta(username, pathname, false);
    try {
      const {modified} = await this.writeFile(dataPath, value);
      // update metadata
      metaData.items[filename] = {
        ETag: modified,
        'Content-Type': type,
        'Content-Length': value.length
      };
      metaData.ETag = modified;
      await writeFile(metaPath, JSON.stringify(metaData, true, 2));
      // update all the hierarchy
      await this._updateParents(username, pathname, modified);
      await this._unlock(username);
      return {created: true, modified};
    } catch (error) {
      await this._unlock(username);
      return {created: false};
    }
  }

  async delete (username, pathname, version) {
    await this._lock(username);
    const {exists, modified, conflict} = await this._delete(username, pathname, version);
    if (!exists || conflict) {
      await this._unlock(username);
      return {deleted: false, conflict};
    }
    // this._removeParents(username, pathname);
    await this._unlock(username);
    return {modified, deleted: true};
  }

  async _delete (username, pathname, version) {
    const dataPath = this.dataPath(username, pathname);
    const filename = path.basename(pathname);
    const metaPath = this._metaPath(username, pathname);
    const metaData = await this.readMeta(username, pathname);

    const {current, exists} = await this.getCurrentState(dataPath, version);
    if (exists === false || !current) {
      return {exists, conflict: !current};
    }
    await unlink(dataPath);
    if (metaData && metaData.items) delete metaData.items[filename];
    await unlink(metaPath);
    metaData.ETag = Date.now().toString();
    // if (Object.keys(metaData.items).length === 0) {
    await this.writeFile(metaPath, JSON.stringify(metaData, true, 2));
    return {modified: metaData.ETag, exists: true};
  }

  async _updateParents (username, pathname, version) {
    const parents = core.parents(pathname, false);
    for (let i = 1; i < parents.length; i++) {
      const metaPath = this._metaPath(username, parents[i], true);
      const metaData = await this.readMeta(username, parents[i], true);
      const basePath = path.basename(parents[i - 1]) + '/';
      metaData.ETag = version;
      metaData.items[basePath] = { ETag: version };
      await writeFile(metaPath, JSON.stringify(metaData, true, 2));
    }
  }

  async _removeParents (username, pathname) {
    const parents = core.parents(pathname);

    let dirname;
    for (let parent of parents) {
      dirname = path.dirname(username, parent);

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

  async readFile (fullPath) {
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

  async writeFile (fullPath, content) {
    let statInfo;

    try {
      await stat(fullPath);
    } catch (e) {
      await mkdirp(path.dirname(fullPath));
    }

    await writeFile(fullPath, content);
    statInfo = await stat(fullPath);

    // TODO: use Date.now instead
    const modified = statInfo.mtime.getTime().toString();
    return { exists: !!statInfo, modified };
  }

  async getCurrentState (fullPath, version) {
    version = version && version.trim().replace(/"/g, '');
    if (!fs.existsSync(fullPath)) {
      if (!version || version === '*') return {current: true, exists: false};
      return {current: false, exists: false};
    }

    // TODO: read metadata file to get `modified`

    const statInfo = await stat(fullPath);
    const isDir = statInfo.isDirectory();
    const modified = statInfo && statInfo.mtime.getTime().toString();
    if (!version) return { current: true, modified, isDir };
    if (version === '*') return { current: !modified, isDir };
    return { current: modified === version, modified, isDir };
  }
}

module.exports = FileTree;
