const crypto = require('crypto');

const core = require('../../stores/core');
const { getRouting } = require('../../utils/routing');
const Controller = require('../../controllers/base');
const { logRequest } = require('../../logger');

class LivenessProbe extends Controller {

  /**
   * Part of middleware mechanism, every middleware needs this static method adhering to this contract.
   * 
   * @param {*} options - to check for availability of this extension
   * @reutrns {bool} whether this class is enabled if `options` indicate as much
   */
  static isEnabled(options) {
    return options.extensions 
      && options.extensions.liveness_probe 
      && options.extensions.liveness_probe.enabled;
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

    if (method === 'GET' && uri.pathname === this._options.extensions.liveness_probe.url_path) {
      await this.getFile();
      return;
    }    

    await this._next();
  }

  async getFile() {
    try {
      const user = await this.server._store.readAuth(this._options.extensions.liveness_probe.user);
      if (!user) {
        await this.server._store.createUser({
          username: this._options.extensions.liveness_probe.user, 
          email: `${core.generateToken()}@${core.generateToken()}.com`,
          password: core.generateToken()
        });
      }  
      let item = (await this.server._store.get(
        this._options.extensions.liveness_probe.user, 
        this._options.extensions.liveness_probe.file_path, 
        null)).item;
      if (!item) {
        const content =  crypto.randomBytes(this._options.extensions.liveness_probe.file_size_bytes).toString('base64');
        await this.server._store.put(
          this._options.extensions.liveness_probe.user, 
          this._options.extensions.liveness_probe.file_path, 
          `text/plain`,
          content,
          null);    
        item = (await this.server._store.get(
          this._options.extensions.liveness_probe.user, 
          this._options.extensions.liveness_probe.file_path, 
          null)).item;
      }
      this.response.write(item.value, 'utf8');
      this.response.writeHead(200, { 
        'Access-Control-Allow-Origin': this.request.headers.origin || '*',
        'Content-Length': item['Content-Length'] || item.value.length,
        'Content-Type': item['Content-Type'] || ''
      });
      this.response.end();
      return logRequest(this.request, this.params.to, 200, 0, `OK`);      
    } catch (e) {
      this.response.writeHead(400, { 'Access-Control-Allow-Origin': this.request.headers.origin || '*' });
      this.response.end();
      return logRequest(this.request, this.params.to, 400, 0, `liveness_probe invalid`);
    }
  }
}

module.exports = LivenessProbe;

