module.exports = class NoSuchUserError extends Error {
  constructor () {
    super(...arguments);
    this.name = 'NoSuchUserError';
  }
};
