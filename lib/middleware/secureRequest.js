const isSecureRequest = require('../util/isSecureRequest');

/** ensures request is secure, if required */
module.exports = function secureRequest (req, res, next) {
  if (isSecureRequest(req) || (process.env.NODE_ENV !== 'production' && !req.app.get('forceSSL'))) {
    return next();
  }

  res.logNotes.add('blocked insecure');
  res.status(400).type('text/plain').send('The request did not use HTTPS.');
};
