const core = require('./core');
const fs = require('fs');
const { promisify } = require('util');
const lockfile = require('lockfile');
const mkdirp = require('mkdirp');
const path = require('path');
const { getLogger } = require('../logger');

// promisify
const lock = promisify(lockfile.lock);
const unlock = promisify(lockfile.unlock);
const unlink = promisify(fs.unlink);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

class FileTree {
  constructor (options) {
    this._dir = path.resolve(options.path);
  }

  async _lock (username) {
    const lockPath = path.join(this._dir, username.substr(0, 2), username, '.lock');
    try {
      await lock(lockPath, { wait: 200 });
    } catch (e) {
      const err = new Error('Locked !?!?' + e.toString());
      getLogger().error('lock failed:', err);
      throw err;
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

  async createUser (params) {
    const errors = core.validateUser(params);
    if (errors.length > 0) throw new Error(errors[0]);

    const username = params.username;
    const authPath = this._authPath(username);

    const user = await this.readAuth(username);
    if (user) throw new Error(`The username “${username}” is already taken`);

    await mkdirp(path.dirname(authPath));
    const hash = await core.hashPassword(params.password, null);
    const data = { email: params.email, password: hash };
    return writeFile(authPath, JSON.stringify(data, true, 2));
  }

  async readJson (path) {
    try {
      const content = await readFile(path);
      return content ? JSON.parse(content) : null;
    } catch (e) {
      if (e.code !== 'ENOENT') {
        getLogger().error('reading JSON failed:', e);
      }
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

  async authorize (clientId, username, password, permissions) {
    await this.authenticate({ username, password });
    const token = core.generateToken();
    const user = await this.readAuth(username);
    let category;

    user.sessions = user.sessions || {};
    const session = user.sessions[token] = { clientId, permissions: {} };

    // use lodash
    for (const scope in permissions) {
      category = scope.replace(/^\/?/, '/').replace(/\/?$/, '/');
      session.permissions[category] = {};
      for (let i = 0, n = permissions[scope].length; i < n; i++) {
        session.permissions[category][permissions[scope][i]] = true;
      }
    }

    await writeFile(this._authPath(username),
      JSON.stringify(user, true, 2));

    return token;
  }

  async revokeAccess (username, token) {
    await this._lock(username);
    const user = await this.readAuth(username);

    if (user && user.sessions && user.sessions[token]) {
      delete user.sessions[token];
    }
    await writeFile(this._authPath(username), JSON.stringify(user, true, 2));
    await this._unlock(username);
  }

  async permissions (username, token) {
    const user = await this.readAuth(username);
    if (!user) return {};
    const data = user.sessions;
    if (!data || !data[token]) return {};

    const permissions = data[token].permissions;
    if (!permissions) return {};
    const output = {};

    for (const category in permissions) {
      output[category] = Object.keys(permissions[category]).sort();
    }

    return output;
  }

  async get (username, pathname, versions, head = false) {
    versions = versions && versions.split(',');
    const isdir = /\/$/.test(pathname);
    const basename = decodeURI(path.basename(pathname)) + (isdir ? '/' : '');
    const datapath = this.dataPath(username, pathname);

    await this._lock(username);
    const metadata = await this.readMeta(username, pathname, isdir);

    // resource exists?
    let ret;
    if (!isdir && !metadata.ETag) ret = { item: null };
    if (!isdir && !metadata.items[basename]) {
      ret = { item: null, isClash: Boolean(metadata.items[basename + '/']) };
    }
    if (ret) {
      await this._unlock(username);
      return ret;
    }

    // has client the same version of this resource?
    const currentETag = isdir ? metadata.ETag : metadata.items[basename].ETag;
    if (core.versionMatch(versions, currentETag)) {
      await this._unlock(username);
      return { item: metadata, versionMatch: true };
    }

    // dir listing
    if (isdir) {
      await this._unlock(username);
      if (metadata.items[basename.slice(0, basename.length - 1)]) {
        return { item: null, isClash: true }; // This path is actually a document
      } else {
        return { item: metadata };
      }
    } else {
      // do not include content on head request
      const blob = head ? '' : await readFile(datapath);
      await this._unlock(username);

      if (blob === null) return { item: null };
      const item = metadata.items[basename];
      item.value = blob;
      return { item, versionMatch: false };
    }
  }

  async put (username, pathname, type, value, version) {
    const datapath = this.dataPath(username, pathname);
    const metapath = this._metaPath(username, pathname);
    const basename = decodeURI(path.basename(pathname));
    await this._lock(username);
    const metadata = await this.readMeta(username, pathname);
    let created = false;

    if (version) {
      if (version === '*'
        // check document existence when version '*' specified
        ? metadata.items && metadata.items[basename]
        // check version matches when specified
        : !metadata.items || !metadata.items[basename] ||
          version.replace(/"/g, '') !== metadata.items[basename].ETag
      ) {
        await this._unlock(username);
        return { conflict: true, created };
      }
    }

    if (metadata.items[`${basename}/`]) {
      await this._unlock(username);
      return { isClash: true, created };
    }

    // check if something in this path is already a file
    const paths = core.traversePath(pathname);
    const dirClashes = (await Promise.all(
      paths.map(async ({ currentPath, upperBasename }) => {
        const meta = await this.readMeta(username, currentPath, true);
        if (upperBasename !== basename && meta.items && meta.items[upperBasename]) return true;
        return false;
      }))).some(i => i);

    if (dirClashes) {
      await this._unlock(username);
      return { created, isClash: true };
    }

    // create path if does not exists
    if (!metadata.ETag) await mkdirp(path.dirname(datapath));

    try {
      await writeFile(datapath, value);
      const modified = Date.now().toString();
      created = !Object.prototype.hasOwnProperty.call(metadata.items, basename);
      // update metadata
      metadata.items[basename] = {
        ETag: modified,
        'Content-Type': type,
        'Content-Length': value.length,
        'Last-Modified': (new Date()).toUTCString()
      };
      metadata.ETag = modified;
      await writeFile(metapath, JSON.stringify(metadata, true, 2));
      const paths = core.traversePath(pathname);
      await Promise.all(
        paths.map(async ({ currentPath, upperBasename }) => {
          const currentMeta = await this.readMeta(username, currentPath);
          currentMeta.ETag = modified;
          currentMeta.items[path.basename(currentPath) + '/'] = { ETag: modified };
          await writeFile(this._metaPath(username, currentPath), JSON.stringify(currentMeta, true, 2));
        }));
      await this._unlock(username);
      return { created, modified, conflict: false };
    } catch (error) {
      await this._unlock(username);
      getLogger().error('put failed:', error);
      return { created: false, conflict: false };
    }
  }

  async delete (username, pathname, version) {
    const datapath = this.dataPath(username, pathname);
    const basename = decodeURI(path.basename(pathname));
    const metapath = this._metaPath(username, pathname);

    await this._lock(username);
    const metadata = await this.readMeta(username, pathname);
    if (metadata.items[`${basename}/`]) {
      await this._unlock(username);
      return { deleted: false, isClash: true };
    }
    if (!metadata || !metadata.items[basename]) {
      await this._unlock(username);
      return { deleted: false };
    }
    // check if version matches when specified
    if (version) {
      if ((!metadata.items || !metadata.items[basename]) ||
        (metadata.items[basename].ETag !== version.replace(/"/g, ''))
      ) {
        await this._unlock(username);
        return { deleted: false, conflict: true };
      }
    }

    const itemVersion = metadata.items[basename].ETag;
    try {
      // remove file and update metadata
      await unlink(datapath);
      delete metadata.items[basename];
      metadata.ETag = Date.now().toString();
      await writeFile(metapath, JSON.stringify(metadata, true, 2));

      // update all parents
      const paths = core.traversePath(pathname);
      let upperMeta = metadata;
      const tasks = paths.map(({ currentPath, upperBasename }) => async () => {
        // read current metadata
        const currentMeta = await this.readMeta(username, currentPath);
        // remove folder from upper folder in case this is empty
        if (Object.keys(upperMeta.items).length === 0) {
          delete currentMeta.items[path.basename(currentPath) + '/'];
          currentMeta.ETag = metadata.ETag;
          await writeFile(this._metaPath(username, currentPath), JSON.stringify(currentMeta, true, 2));
        }
        upperMeta = currentMeta;
      });

      // resolve these promises sequentially (delete upper dir first)
      await tasks.reduce((promise, task) => {
        return promise.then(result => task().then(Array.prototype.concat.bind(result)));
      }, Promise.resolve([]));
    } catch (e) {
      await this._unlock(username);
      getLogger().error('delete failed:', e);
      return { deleted: false };
    }
    await this._unlock(username);
    return { modified: itemVersion, deleted: true };
  }

  // TODO use traversePath insteads
  async _updateParents (username, pathname, modified) {
    const parents = core.parents(pathname, false);
    for (let i = 1; i < parents.length; i++) {
      const metapath = this._metaPath(username, parents[i], true);
      const metadata = await this.readMeta(username, parents[i], true);
      const basepath = path.basename(parents[i - 1]) + '/';
      metadata.ETag = modified;
      metadata.items[basepath] = { ETag: modified };
      await writeFile(metapath, JSON.stringify(metadata, true, 2));
    }
  }
}

module.exports = FileTree;
