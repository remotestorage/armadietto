module.exports = class NoSuchBlobError extends Error {
  constructor (message, options) {
    super(message, options);
    this.name = 'NoSuchBlobError';
  }
};
