const qs = require('querystring');
const fs = require('fs');
const fastFolderSizeSync = require('fast-folder-size/sync')

const { metadataUpsert: metadataUpsert, metadataDelete: metadataDelete, getMetadata: getMetadata } = require('../utils/token_metadata');
const { getLogger } = require('../../logger');
const { getRouting } = require('../../utils/routing');
const { symmetricEncrypt, symmetricDecrypt } = require('../../utils/symmetric');
const Controller = require('../../controllers/base');

const HAS_WRITE_CAPACITY_METADATA = 'has_write_capacity';
const HAS_WRITE_CAPACITY_METADATA_VALUE_PREFIX = 'ok';

class StorageAllowance extends Controller {

  /**
   * Part of middleware mechanism, every middleware needs this static method adhering to this contract.
   * 
   * @param {*} options - to check for availability of this extension
   * @reutrns {bool} whether this class is enabled if `options` indicate as much
   */
  static isEnabled(options) {
    return options.extensions 
      && options.extensions.storage_allowance 
      && options.extensions.storage_allowance.enabled;     
  }

  /**
   * Part of middleware mechanism, every middleware needs to extent the `Controller` class and have a constructor adhering to this contract.
   * 
   * @param {*} server - instance of the overall server
   * @param {*} request - the request this instance is for
   * @param {*} response - the response this instance is for
   * @param {*} next - the next middleware to call to continue processing during handling
   * @param {*} options - the options object
   */
  constructor (server, request, response, next, options) {
    super(server, request, response);
    this._next = next;
    this._store = options.store;
    this._options = options;
  }

  /**
   * Part of middleware mechanism, every middleware is called at most once per instance of this class to handle its business.
   * Actual request handler called from other middleware.  Act on `request` from constructor and set state of `response`.
   * Make sure to call `next` when ready call deeper into middleware stack, before handling responses in your middleware.
   */
   handle = async () => { 
    const [method, uri, _] = getRouting(this.request, this._options);
    const candidateResponse = this.response.getCandidate();
    const salt = this._options.extensions.storage_allowance.salt;

    let match;

    if (method === 'POST' && (uri.pathname === 'oauth' || uri.pathname === 'pay2myapp')) {
      await this._next();

      const username = this.params.username;
      const size = this.getSize(username);
      let hasCapacity = true;
      if (this._options.extensions.storage_allowance.max_bytes) {
        hasCapacity = size < this._options.extensions.storage_allowance.max_bytes;
      }

      const location = candidateResponse.headers['Location'];
      if (!location) return;
      const preamble = location.split('#')[0];
      const coded = location.split('#')[1];
      const decoded = qs.parse(coded);
      const token = decoded.access_token;
      if (hasCapacity) {
        var value = symmetricEncrypt(`${HAS_WRITE_CAPACITY_METADATA_VALUE_PREFIX}::${(new Date()).toUTCString()}`, salt);
      } else {
        var value = 'false';
      }
      const updatedToken = metadataUpsert(token, HAS_WRITE_CAPACITY_METADATA, value);
      const newcoded = {...decoded, access_token: updatedToken};
      const encoded = qs.stringify(newcoded);
      candidateResponse.headers['Location'] = `${preamble}#${encoded}`;

      return;
    }

    if (this.request.headers.authorization) {
      const token = decodeURIComponent(this.request.headers.authorization.split(/\s+/)[1]);
      var metadata = getMetadata(token);
      const updatedToken = metadataDelete(token, HAS_WRITE_CAPACITY_METADATA);
      this.request.headers.authorization = `Bearer ${updatedToken}`;
    } 

    match = uri.pathname.match(/^storage\/([^/]+)(.*)$/);
    if (method === 'PUT' && match) {
      const username = decodeURIComponent(match[1]).split('@')[0];
      const path = match[2];

      let canWrite = false;
      if (metadata[HAS_WRITE_CAPACITY_METADATA]) {
        try {
          const decoded = symmetricDecrypt(metadata[HAS_WRITE_CAPACITY_METADATA], salt);
          canWrite = decoded.toString().startsWith(HAS_WRITE_CAPACITY_METADATA_VALUE_PREFIX);
        } catch {}
      }
      if (!canWrite) {
        getLogger().error(`denied write: user:${username} path:${path} :: insufficient capacity`);
        this.response.writeHead(507, this._headers);
        this.response.end();
        return;
      }
    }

    await this._next();
  }

  getSize(username) {
    const datapath = this._store.dataPath(username, '/');
    try {
      if (!fs.existsSync(datapath)) {
        return 0;
      }
    } catch(err) {
      return 0;
    }
    const size = fastFolderSizeSync(datapath);
    getLogger().notice(`capacity?: user:${username} size:${size} capacity:${this._options.extensions.storage_allowance.max_bytes}`);
    return size;
  }
}

module.exports = StorageAllowance;

