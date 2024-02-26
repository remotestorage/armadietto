const isSecureRequest = require('../util/isSecureRequest');
const { logRequest } = require('../logger');

/** ensures request is secure, if required */
module.exports = function secureRequest (req, res, next) {
  if (isSecureRequest(req) || (process.env.NODE_ENV !== 'production' && !req.app.get('forceSSL'))) {
    return next();
  }

  res.status(400).end(); // TODO: add an explanatory message
  logRequest(req, '-', 400, 0, 'blocked insecure');
};
