/** Thrown to tell the top-level handler what to respond with. */

module.exports = class EndResponseError extends Error {
  constructor (message, options, statusCode, logLevel = undefined) {
    super(...arguments);
    this.name = 'EndResponseError';
    this.statusCode = statusCode;
    this.logLevel = logLevel;
  }
};
