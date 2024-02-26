const isSecureRequest = require('./isSecureRequest');

function getHost (req) {
  return req.get('x-forwarded-host') || req.get('host') || req.app.locals.host || '';
}

function getHostBaseUrl (req) {
  const scheme = (isSecureRequest(req) || req.app.get('forceSSL') || process.env.NODE_ENV === 'production') ? 'https' : 'http';
  return scheme + '://' + getHost(req) + req.app.locals.basePath;
}

module.exports = { getHost, getHostBaseUrl };
