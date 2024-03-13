const core = require('../stores/core');
const { logRequest } = require('../logger');

/** fails request if req.data.username doesn't pass core.isValidUsername
 * TODO: have store validate username
 * */
module.exports = function validUser (req, res, next) {
  if (core.isValidUsername(req.params.username || req.data.username)) { return next(); }

  res.status(400).type('text/plain').end();

  logRequest(req, req.data.username, 400, 0, 'invalid user');
};
