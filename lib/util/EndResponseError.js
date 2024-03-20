module.exports = class EndResponseError extends Error {
  constructor (message, options, statusCode, logLevel) {
    super(...arguments);
    this.name = 'EndResponseError';
    this.statusCode = statusCode;
    this.logLevel = logLevel;
  }
};
