module.exports = class ParameterError extends Error {
  constructor () {
    super(...arguments);
    this.name = 'ParameterError';
  }
};
