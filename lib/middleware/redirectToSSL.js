const isSecureRequest = require('../util/isSecureRequest');
const { getHost } = require('../util/getHost');
const { logRequest } = require('../logger');

/** redirects to HTTPS server if needed */
module.exports = function redirectToSSL (req, res, next) {
  if (isSecureRequest(req) || (process.env.NODE_ENV !== 'production' && !req.app.get('forceSSL'))) {
    return next();
  }

  const host = getHost(req).split(':')[0] + (req.app.get('httpsPort') ? ':' + req.app.get('httpsPort') : '');
  const newUrl = 'https://' + host + req.url;

  res.redirect(302, newUrl);
  logRequest(req, '-', 302, 0, '-> ' + newUrl);
};
