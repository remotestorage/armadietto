const redis = require('redis');
const { RateLimiterRedis } = require('rate-limiter-flexible');

const Controller = require('../../controllers/base');
const { getLogger, logRequest } = require('../../logger');

class RateLimiter extends Controller {
  static client = null;
  static rateLimiterRedis = null;

  /**
   * Part of middleware mechanism, every middleware needs this static method adhering to this contract.
   *
   * @param {*} options - to check for availability of this extension
   * @reutrns {bool} whether this class is enabled if `options` indicate as much
   */
  static isEnabled (options) {
    const result = options.extensions?.rate_limiter?.enabled;

    if (result && !RateLimiter.client) {
      RateLimiter.connect(options);
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
    try {
      console.log(`huh ${String(this.request.socket.remoteAddress)}`);
      await RateLimiter.rateLimiterRedis.consume(this.request.socket.remoteAddress);
    } catch (e) {
      if (e instanceof Error) {
        getLogger().error(`error throttling: ${e}`);
      } else {
        const secs = Math.round(e.msBeforeNext / 1000) || 1;
        this.response.writeHead(429, { 'Retry-After': String(secs) });
        this.response.end();
        return logRequest(this.request, this.params.to, 429, 0, 'Too Many Requests');
      }
    }

    await this._next();
  };

  static connect = async (options) => {
    RateLimiter.client = redis.createClient({
      enableOfflineQueue: false,
      url: options.extensions.rate_limiter.redis_url
    });

    RateLimiter.client.on('error', (err) => {
      getLogger().error('redis client error, npm redis will attempt reconnect', err);
    });

    RateLimiter.client.on('ready', () => {
      getLogger().notice('redis client ready');
    });

    RateLimiter.rateLimiterRedis = new RateLimiterRedis({
      storeClient: RateLimiter.client,
      points: options.extensions.rate_limiter.requests_per_window,
      duration: options.extensions.rate_limiter.limiting_window_seconds
    });
  };
}

module.exports = RateLimiter;
