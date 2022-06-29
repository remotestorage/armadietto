/**
 * CouchDB store (backend) for Armadietto remoteStorage server
 *
 * The CouchDB cluster must be configured with couch_peruser enable=true.
 * Typically you will also set delete_dbs=true.
 * Set pbkdf2 iterations to at least 700,000 in 2022,
 * and 100,000 more each year.
 * You can configure the other CouchDB settings as needed.
 * Ensure CouchDB can only be accessed from the machines that
 * Armadietto is running on.
 *
 * One CouchDB user is created for each RS user.
 * CouchDB users not created by Armadietto would need to have a design
 * document copied over, and Couch permissions set.
 *
 * If admin credentials are not supplied, or invalid, users can't be created
 * and obsolete permissions won't be deleted, but users can still access
 * their documents normally.
 *
 * Each user's data is stored in their per-user (private) database.
 * No other databases are used.
 * Each RS document stores its metadata in a CouchDB document,
 * and its content in an attachment.
 *
 * Each RS session is stored in a document. When a client presents an
 * expired token, the associated session document is deleted.
 * If a client abandons a session before it expires, the session
 * document will never be deleted.  Annually,
 * sessions older than the token ("cookie") timeout should be
 * deleted manually by an administrator, using the `sessions` view,
 * with `reduce=false`.
 *
 * Multiple Armadietto instances can access a single CouchDB cluster.
 *
 * The RS document size limit is the CouchDB maximum attachment size
 * (1 GiB by default), and can be configured in CouchDB configuration.
 * Each user can store about 300 million documents.
 * Performance near this limit has not been tested.
 *
 * If other server applications respect the document structure, they could access the
 * user's per-user database directly.
 */

const Buffer = require('buffer').Buffer;
const core = require('./core');
const nanoConnect = require('nano');
const crypto = require('crypto');
const { getLogger } = require('../../lib/logger');
const path = require('path').posix;

const VALID_USER_NAME_PATT = /^\S{2,}$/;

function userDbName (username) {
  return 'userdb-' + Buffer.from(username).toString('hex');
}

function loggerCouch (data) {
  if ('err' in data) {
    if (data.err) { // response with error
      let path = '';
      if (data.headers?.uri) {
        const url = new URL(data.headers?.uri);
        path = url.pathname + url.search;
      }
      const msg = `CouchDB ${data.headers?.statusCode} ${data.body?.error} ${data.body?.reason} ${path}`;
      if (data.body?.error === 'conflict') {
        getLogger().info(msg);
      } else if ([401, 403, 404].includes(data.headers?.statusCode)) {
        getLogger().info(msg);
      } else {
        getLogger().warning(msg);
      }
    } else { // response (no error)
      getLogger()?.debug(`CouchDB ${data.headers?.statusCode} ${bodyToString(data)}`);
    }
  } else { // request
    const url = new URL(data.url);
    getLogger()?.debug(`CouchDB ${data.method} ${url?.pathname}${url?.search}`);
  }

  function bodyToString (data) {
    const body = data.body;
    if (body instanceof Buffer) {
      const str = body.toString('hex', 0, 30);
      if (body.length > 30) {
        return str + '...';
      } else {
        return str;
      }
    } else if (body instanceof Object) {
      const output = [];
      for (const [key, value] of Object.entries(body)) {
        if (key === 'ok') {
          continue;
        }
        if (key === 'message' && body.message === body.reason) {
          continue;
        }
        output.push(key + ':' + JSON.stringify(value));
      }
      if (output.length > 0) {
        return output.join(' ');
      } else {
        let path = '';
        if (data.headers?.uri) {
          const url = new URL(data.headers?.uri);
          path = url.pathname + url.search;
        }
        return path;
      }
    } else {
      return String(body);
    }
  }
}

/**
 * For documents, only one row will be involved, and all fields are meaningful.
 * For folders, multiple rows will be involved, and most sums are superfluous.
 * numContainedDocs does not include documents at the top level.
 **/
const RSDesignDoc = {
  _id: '_design/remoteStorage',
  views: {
    sums: {
      map: `
function (doc) {
  if (doc._id[0] !== '/') {
    return;
  }
  const rev = doc._rev.split('-');
  const etagN = parseInt(rev[0]);
  const etagHash = Array.from(rev[1]).map(c => parseInt(c,16));
  const numContainedDocs = new Array(doc.pathArr.length-1);
  numContainedDocs.fill(1);
  const content = doc._attachments && doc._attachments.content || {};
  const contentLength = content.length || 0;
  const contentType = Array.from(content.content_type || '').map(c => c.charCodeAt(0));
  emit(doc.pathArr, {etagN, etagHash, numContainedDocs, contentType, contentLength, lastModified: Date.parse(doc.lastModified)});
}`,
      reduce: '_sum'
    },
    sessions: {
      map: `
function (doc) {
  if ('/' === doc._id[0] || '_' === doc._id[0]) {
    return;
  }
  emit(doc.dateBegin, doc.clientId);
}`,
      reduce: '_count'
    }
  },
  language: 'javascript'
};

/**
 * Manages the connection to the CouchDB cluster.
 * The CouchDB cluster must be started before Armadietto.
 *
 * @param {Object} options
 * @param {string} [options.url=http://localhost:5984]
 * @param {string} [options.userAdmin=admin]
 * @param {string} options.passwordAdmin
 */
class CouchDB {
  constructor (options) {
    this._url = options?.url || 'http://localhost:5984';
    this._userAdmin = options?.userAdmin || 'admin';
    this._passwordAdmin = options?.passwordAdmin;
    getLogger()?.notice(`connecting to CouchDB at ${this._url}`);
    this._perUserDB = {};
  }

  /**
   * Creates a new RS user, which is also a CouchDB user
   * @param params
   * @param {string} params.username
   * @param {string} params.email
   * @param {string} params.password
   * @returns {Promise<void>}
   * @throws {Error} if parameters are invalid, user name is already taken, or admin credentials invalid
   */
  async createUser (params) {
    const errors = core.validateUser(params, VALID_USER_NAME_PATT, 'non-space characters');
    if (errors.length > 0) throw new Error(errors.join(', '));
    let nanoAdmin;
    try {
      nanoAdmin = nanoConnect({
        url: this._url,
        requestDefaults: {
          jar: true
        },
        log: loggerCouch
      });
      await nanoAdmin.auth(this._userAdmin, this._passwordAdmin);
    } catch (err) {
      const reason = ([401, 403].includes(err.statusCode) ? 'admin account ' : '') + err.message;
      getLogger()?.error('Failed to create user: ' + reason);
      throw new Error('Unable to sign up new users; contact the administrator');
    }

    try {
      const users = nanoAdmin.use('_users');
      const salt = crypto.randomBytes(16).toString('hex');
      // pbkdf2 iterations must be set in CouchDB configuration
      // const RECOMMENDATION_DATE = new Date(2022, 4, 10);
      // const iterations = 720_000 + Math.floor(100_000 * (Date.now() - RECOMMENDATION_DATE) / (365 * 24 * 60 * 60 * 1000) + 10_000 * Math.random());
      await users.insert({
        _id: 'org.couchdb.user:' + params.username,
        type: 'user',
        name: params.username,
        password: params.password,
        salt,
        password_scheme: 'pbkdf2',
        // iterations,
        roles: [],
        email: params.email
      });

      const dbName = userDbName(params.username);
      const perUserDB = nanoAdmin.use(dbName);
      const startTime = Date.now();
      do {
        // TODO: reduce timeout when code is out of alpha
        await new Promise(resolve => setTimeout(resolve, 200));
        try {
          await perUserDB.insert({
            members: { roles: ['_admin'], names: [params.username] },
            admins: { roles: ['_admin'], names: [] }
          },
          '_security'
          );
          /* const response3 = */ await perUserDB.insert(RSDesignDoc, '_design/remoteStorage');
          getLogger().notice(`configured user “${params.username}” with database ${dbName}`);
          break;
        } catch (err) {
          if (err.statusCode !== 404 || Date.now() - startTime > 30_000) {
            throw err;
          } else {
            getLogger().info(`will re-try to set ${params.username} auth in ${dbName}`);
          }
        }
      } while (true);
    } catch (err) {
      if (err.statusCode === 409) {
        throw new Error(`The username “${params.username}” is already taken`);
      } else {
        throw err;
      }
    }
  }

  /**
   * @param {Object} params
   * @param {string} params.username
   * @param {string} params.password
   * @returns {Object} the per-user database
   * @throws {Error} if password & username don't match
   */
  async authenticate (params) {
    const perUserDB = nanoConnect({
      url: (new URL(userDbName(params.username), this._url)).href,
      requestDefaults: {
        jar: true
      },
      log: loggerCouch
    });
    await perUserDB.auth(params.username, params.password);
    // console.log(`authenticated ${params.username}: ${perUserDB.server?.config?.cookies?.[0]?.value}`);

    this._perUserDB[params.username] = perUserDB;
    return perUserDB;
  }

  /**
   * Creates a session for this client app holding permissions
   * @param {string} clientId URL
   * @param {string} username
   * @param {string} password
   * @param {object} permissions - one field per scope
   * @returns {Promise<string>} clientPermissionsToken
   * @throws {Error} if authentication fails or session can't be saved
   */
  async authorize (clientId, username, password, permissions) {
    const perUserDB = await this.authenticate({ username, password });
    const cookies = await perUserDB?.server?.config?.cookieJar?.getCookies(this._url);
    const authCookie = cookies.find(cookie => cookie.key === 'AuthSession');
    const clientPermissionsToken = authCookie.value;

    const session = { _id: clientPermissionsToken, clientId, permissions: {}, dateBegin: (new Date()).toISOString() };

    for (const scope in permissions) {
      const category = scope.replace(/^\/?/, '/').replace(/\/?$/, '/');
      session.permissions[category] = permissions[scope];
    }
    getLogger()?.notice(`User “${username}” authorized client with ${JSON.stringify(session)}`);

    // Uses authorization token as database ID
    await perUserDB.insert(session);

    return clientPermissionsToken;
  }

  /**
   * Retrieves permissions given to client for this session (with this token).
   * @param {string} username
   * @param {string} token returned from authorize(), passed to client and back
   * @returns {Promise<{}|null>} permissions object (possibly empty), or null if token is not valid
   */
  async permissions (username, token) {
    const perUserDB = nanoConnect({
      url: (new URL(userDbName(username), this._url)).href,
      requestDefaults: {
        jar: true
      },
      log: loggerCouch
    });
    await perUserDB.server?.config?.cookieJar?.setCookie('AuthSession=' + token, this._url, { httpOnly: true });
    // const newCookies = await perUserDB.server?.config?.cookieJar?.getCookies(this._url);
    // console.log('permissions(): new cookies:', newCookies);
    let session;
    try {
      // Uses authorization token as database ID
      session = await perUserDB?.get(token);
      // console.log('permissions:', session?.clientId, session?.permissions);
      this._perUserDB[username] = perUserDB;
    } catch (err) {
      switch (err.statusCode) {
        case 401:
        case 403:
          await this.revokeAccess(username, token);
          return null;
        case 404:
          return {};
        default:
          throw err;
      }
    }
    return session.permissions || {};
  }

  async revokeAccess (username, token) {
    if (!this._passwordAdmin) {
      return;
    }

    let nanoAdmin;
    try {
      nanoAdmin = nanoConnect({
        url: this._url,
        requestDefaults: {
          jar: true
        },
        log: loggerCouch
      });
      await nanoAdmin.auth(this._userAdmin, this._passwordAdmin);
    } catch (err) {
      const reason = ([401, 403].includes(err.statusCode) ? 'admin account ' : '') + err.message;
      getLogger()?.error('revokeAccess: Admin failed to authenticate: ' + reason);
      return undefined;
    }
    const perUserDB = nanoAdmin.use(userDbName(username));

    let session;
    try {
      session = await perUserDB?.get(token);
      // console.log('removing authorization:', session?.clientId, session?.permissions);
      await perUserDB?.destroy(token, session._rev);
    } catch (err) {
      switch (err.statusCode) {
        case 401:
        case 403:
          getLogger()?.info(`User “${username}” lacks permission to revoke token in “${perUserDB?.config?.db}” ` + JSON.stringify(session));
          return undefined;
        case 404: // the session has already been deleted
          return undefined;
        default:
          throw err;
      }
    }
  }

  _splitPath (pathname) {
    if (pathname.length <= 1) {
      return [];
    }
    const pathParsed = path.parse(pathname);
    if (pathParsed.dir === pathParsed.root) {
      return [pathParsed.base];
    } else {
      return [...pathParsed.dir.split(path.sep).slice(1), pathParsed.base];
    }
  }

  _convertCouchDocToRSMeta (couchDoc, head) {
    const content = couchDoc._attachments?.content;
    const value = head ? null : Buffer.from(content.data, 'base64');
    return {
      ETag: couchDoc._rev,
      'Content-Type': content.content_type,
      'Content-Length': head ? content.length : value.length,
      'Last-Modified': couchDoc.lastModified,
      value
    };
  }

  _extractMetadataFromFirstRow (rows, pathLength) {
    if (rows.length === 1) {
      const value = rows[0].value;
      const ETag = value.etagN + '-' + value.etagHash.map(x => (x % 16).toString(16)).join('');
      if (pathLength === 0 || value.numContainedDocs[pathLength - 1]) {
        return { ETag };
      } else {
        return {
          ETag,
          'Content-Type': rows[0].value?.contentType?.map(x => String.fromCharCode(Math.min(x, 126))).join(''),
          'Content-Length': rows[0].value?.contentLength,
          'Last-Modified': rows[0].value?.lastModified ? (new Date(rows[0].value?.lastModified)).toUTCString() : ''
        };
      }
    } else if (rows.length > 1) {
      throw new Error(`reduced value should have one row, not ${rows.length}`);
    } else { // Nothing exists at this path
      return { ETag: '' };
    }
  }

  async _getFolderMetadata (perUserDB, folderPathArr) {
    // TODO: refactor core.js and/or storage.js so we don't have to return children if not needed
    const queries = [
      {
        startkey: folderPathArr,
        endkey: [...folderPathArr, {}],
        group_level: folderPathArr.length
      },
      {
        startkey: [...folderPathArr, null],
        endkey: [...folderPathArr, {}],
        group_level: folderPathArr.length + 1
      }
    ];
    const batch = await perUserDB.server.request({
      db: perUserDB.config.db,
      method: 'POST',
      path: '_design/remoteStorage/_view/sums/queries',
      body: { queries }
    });
    const metadata = this._extractMetadataFromFirstRow(batch.results[0].rows, folderPathArr.length);
    metadata.items = {};
    for (const row of batch.results[1].rows) {
      let itemName = decodeURI(row.key[row.key.length - 1]);
      const ETag = row.value.etagN + '-' + row.value.etagHash.map(x => (x % 16).toString(16)).join('');
      const metaItem = { ETag };
      if (!row.value.numContainedDocs[folderPathArr.length]) { // document, not folder
        metaItem['Content-Type'] = row.value?.contentType?.map(x => String.fromCharCode(Math.min(x, 126))).join('');
        metaItem['Content-Length'] = row.value?.contentLength;
        metaItem['Last-Modified'] = row.value?.lastModified ? (new Date(row.value?.lastModified)).toUTCString() : '';
      } else {
        itemName += '/';
      }
      metadata.items[itemName] = metaItem;
    }
    return metadata;
  }

  /** returns ETags for item & ancestors */
  async _getMetadatasIncludingAncestors (perUserDB, pathArr) {
    const queries = [];
    for (let i = pathArr.length; i > 0; --i) {
      queries.push({
        startkey: pathArr.slice(0, i),
        endkey: [...pathArr.slice(0, i), {}],
        group_level: i
      });
    }
    const batch = await perUserDB.server.request({
      db: perUserDB.config.db,
      method: 'POST',
      path: '_design/remoteStorage/_view/sums/queries',
      body: { queries }
    });
    return batch.results.map((result, j) => this._extractMetadataFromFirstRow(result.rows, pathArr.length - j));
  }

  async get (username, pathname, versions, head = false) {
    const perUserDB = this._perUserDB[username];
    if (!perUserDB) {
      return {};
    }

    const isExpectedToBeFolder = pathname[pathname.length - 1] === '/';

    const pathArr = this._splitPath(pathname);
    let metadata;
    if (isExpectedToBeFolder) {
      metadata = await this._getFolderMetadata(perUserDB, pathArr);
      if ('Content-Type' in metadata) {
        return { item: null, isClash: true }; // status 409 is returned to client
      }
    } else {
      try {
        const couchDoc = await perUserDB.get(pathname, { attachments: !head });
        if (couchDoc._attachments?.content) {
          metadata = this._convertCouchDocToRSMeta(couchDoc, head);
        } else {
          // This should not happen, but if it does,
          // documents with no content attachment are treated as a legitimate empty document.
          getLogger().warning(`Returning empty document for missing attachment at ${pathname}`);
          metadata = {
            ETag: couchDoc._rev,
            'Content-Type': 'application/octet-stream',
            'Content-Length': 0,
            'Last-Modified': couchDoc.lastModified,
            value: head ? null : Buffer.alloc(0)
          };
        }
      } catch (err) {
        if (err.statusCode === 404) {
          return { item: null };
        } else {
          throw err;
        }
      }
    }

    // if client has the same version, returns match flag true
    if (core.versionMatch(versions?.split(','), metadata.ETag)) {
      return { item: metadata, versionMatch: true };
    }

    return { item: metadata };
  }

  async put (username, pathname, type, value, version) {
    const perUserDB = this._perUserDB[username];
    if (!perUserDB) {
      return {};
    }

    const pathArr = this._splitPath(pathname);
    const metadatas = await this._getMetadatasIncludingAncestors(perUserDB, pathArr);

    // Checks whether path refers to existing folder
    if (metadatas[0].ETag && !('Content-Type' in metadatas[0])) {
      return { created: false, isClash: true }; // status 409 is returned to client
    }
    // Checks whether any ancestor is existing document
    for (let i = 1; i < metadatas.length; ++i) {
      if (metadatas[i].ETag && 'Content-Type' in metadatas[i]) {
        return { created: false, isClash: true }; // status 409 is returned to client
      }
    }

    if (version) {
      if (version === '*'
      // checks document existence when version '*' specified
        ? metadatas[0].ETag
      // checks version match when specified
        : !metadatas[0].ETag ||
          version.replace(/"/g, '') !== metadatas[0].ETag
      ) {
        return { conflict: true, created: false };
      }
    }

    const metaNew = {
      _id: pathname,
      pathArr,
      lastModified: (new Date()).toUTCString()
    };
    // if document already existed, we must pass old rev
    if (metadatas[0].ETag) {
      metaNew._rev = metadatas[0].ETag;
    }
    const metadataResult = await perUserDB.insert(metaNew);
    const attachmentResult = await perUserDB.attachment.insert(pathname, 'content', value, type, { rev: metadataResult.rev });

    // The updated CouchDB View will return updated ETags for this
    // document's parent folders.
    return { created: !metadatas[0].ETag, modified: attachmentResult.rev, conflict: false };
  }

  /**
   * @returns {{deleted: boolean , conflict: boolean , modified: (string|number)}}
   */
  async delete (username, pathname, version) {
    const perUserDB = this._perUserDB[username];
    if (!perUserDB) {
      return {};
    }

    // If version is passed, lets CouchDB handle this efficiently.
    if (version?.length === 34) {
      try {
        const deleteResult = await perUserDB.destroy(pathname, version);
        return { deleted: true, modified: deleteResult.rev };
      } catch (err) {
        switch (err.statusCode) {
          case 404: // document doesn't exist
          case 409: // version doesn't match
            return { deleted: false, conflict: true };
          default:
            throw err;
        }
      }
    }

    // Otherwise, handles this with multiple requests.
    let metadata;
    try {
      const couchDoc = await perUserDB.get(pathname);
      if (couchDoc._attachments?.content) {
        metadata = this._convertCouchDocToRSMeta(couchDoc, true);
      } else {
        getLogger().warning(`Deleting document with missing attachment at ${pathname}`);
        metadata = {
          ETag: couchDoc._rev,
          'Content-Type': 'application/octet-stream'
          // 'Content-Length': 0,
          // 'Last-Modified': couchDoc.lastModified,
        };
      }
    } catch (err) {
      if (err.statusCode === 404) {
        return { deleted: false };
      } else {
        throw err;
      }
    }

    // Document exists; this actually deletes it.
    // The updated CouchDB View will not contain any folders that
    // are now empty.
    const deleteResult = await perUserDB.destroy(pathname, metadata.ETag);
    // console.log(`deleted document ${pathname}`, deleteResult)

    return { modified: deleteResult.rev, deleted: true };
  }
}

module.exports = CouchDB;
