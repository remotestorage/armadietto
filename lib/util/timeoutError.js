/** TODO: replace this with EndResponseError */

module.exports = class TimeoutError extends Error {
  constructor () {
    super(...arguments);
    this.name = 'TimeoutError';
  }
};
