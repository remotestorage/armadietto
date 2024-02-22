function getHost (req) {
  return req.headers['x-forwarded-host'] || req.headers.host || '';
}

module.exports = getHost;
