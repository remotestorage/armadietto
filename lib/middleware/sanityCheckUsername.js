const { logRequest } = require('../logger');

/** sanity check of username, to defend against ".." and whatnot */
module.exports = function sanityCheckUsername (req, res, next) {
  const username = req.params.username || req.data.username || '';
  if (username.length > 0 && !/\/|^\.+$/.test(username) && /[\p{Lu}\p{Ll}\p{Lt}\p{Lo}\p{Nd}]{1,63}/u.test(username)) {
    return next();
  }

  res.status(400).type('text/plain').end();

  logRequest(req, req.data.username, 400, 0, 'invalid user');
};
