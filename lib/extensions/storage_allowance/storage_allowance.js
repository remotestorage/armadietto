const fs = require('fs');
const fastFolderSizeSync = require('fast-folder-size/sync');
const redis = require('redis');
const { RateLimiterRedis } = require('rate-limiter-flexible');

const { getLogger } = require('../../logger');
const { getRouting } = require('../../utils/routing');
const { responseLocationPush, bearerTokenPop } = require('../utils/token_metadata');
const { symmetricEncrypt, symmetricDecrypt } = require('../../utils/symmetric');
const Controller = require('../../controllers/base');

const ORIGINAL_WRITE_CAPACITY_METADATA = 'og_write_capacity';

class StorageAllowance extends Controller {
  static client = null;
  static rateLimiterRedis = null;

  /**
   * Part of middleware mechanism, every middleware needs this static method adhering to this contract.
   *
   * @param {*} options - to check for availability of this extension
   * @reutrns {bool} whether this class is enabled if `options` indicate as much
   */
  static isEnabled (options) {
    const result = options.extensions?.storage_allowance?.enabled;

    if (result && !StorageAllowance.client) {
      StorageAllowance.connect(options);
    }

    return result;
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
    const [method, uri] = getRouting(this.request, this._options);
    const candidateResponse = this.response.getCandidate();

    if (method === 'POST' && (uri.pathname === 'oauth' || uri.pathname === 'pay2myapp')) {
      await this._next();
      this.updateTokenOrWarn(candidateResponse);
      return;
    }

    // extract metadata and strip token
    const [tokenMetadata, authToken] = bearerTokenPop(this.request, ORIGINAL_WRITE_CAPACITY_METADATA);

    const match = uri.pathname.match(/^storage\/([^/]+)(.*)$/);
    if (match) {
      const username = decodeURIComponent(match[1]).split('@')[0];
      const path = match[2];

      if (method === 'PUT') {
        const originalSize = await this._store.getSize(username, path);
        const finalSize = this.request.buffer.length;
        if (!await this.updateCapacity(finalSize - originalSize, tokenMetadata, authToken)) {
          getLogger().error(`denied write: user:${username} path:${path} :: insufficient capacity`);
          this.response.writeHead(507, this._headers);
          this.response.end();
          return;
        }
      } else if (method === 'DELETE') {
        const originalSize = await this._store.getSize(username, path);
        await this._next();
        const finalSize = await this._store.getSize(username, path);
        await this.updateCapacity(finalSize - originalSize, tokenMetadata, authToken);
        return;
      }
    }

    await this._next();
  };

  updateTokenOrWarn (candidateResponse) {
    const username = this.params.username;
    const [usage, available] = this.getAvailable(username);
    const salt = this._options.extensions.storage_allowance.salt;
    const salted = symmetricEncrypt(`${usage}`, salt);
    responseLocationPush(candidateResponse, ORIGINAL_WRITE_CAPACITY_METADATA, salted);
    if (available <= 0) {
      const params = {
        username,
        allowance: this._options.extensions.storage_allowance.max_bytes,
        usage,
        location: candidateResponse.headers.Location
      };
      this.renderHTML(200, 'extensions/capacity_error.html', params);
    }
  }

  getAvailable (username) {
    const datapath = this._store.dataPath(username, '/');
    try {
      if (!fs.existsSync(datapath)) {
        return 0;
      }
    } catch (err) {
      return 0;
    }
    const size = fastFolderSizeSync(datapath);
    const available = this._options.extensions.storage_allowance.max_bytes - size;
    getLogger().notice(`capacity?: user:${username} size:${size} capacity:${this._options.extensions.storage_allowance.max_bytes} delta:${available}`);
    return [size, available];
  }

  async updateCapacity (sizeDelta, tokenMetadata, authToken) {
    try {
      const key = `capacity_${authToken}`;
      const currentTracked = await StorageAllowance.rateLimiterRedis.get(key);
      let consumed = 0;
      if (!currentTracked) {
        const salted = tokenMetadata[ORIGINAL_WRITE_CAPACITY_METADATA];
        const salt = this._options.extensions.storage_allowance.salt;
        consumed = +symmetricDecrypt(salted, salt);
      } else {
        consumed = currentTracked.consumedPoints;
      }
      const newValue = consumed + sizeDelta;
      await StorageAllowance.rateLimiterRedis.set(key, newValue, 0);
      return newValue <= this._options.extensions.storage_allowance.max_bytes;
    } catch (e) {
      getLogger().error(`error validating capacity: ${e}`);
    }

    return false;
  }

  static connect = async (options) => {
    StorageAllowance.client = redis.createClient({
      enableOfflineQueue: false,
      url: options.extensions.storage_allowance.redis_url
    });

    StorageAllowance.client.on('error', (err) => {
      getLogger().error('redis client error, npm redis will attempt reconnect', err);
    });

    StorageAllowance.client.on('ready', () => {
      getLogger().notice('redis client ready');
    });

    StorageAllowance.rateLimiterRedis = new RateLimiterRedis({
      storeClient: StorageAllowance.client,
      points: options.extensions.storage_allowance.max_bytes,
      duration: 0
    });
  };
}

module.exports = StorageAllowance;
