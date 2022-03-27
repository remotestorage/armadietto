const url = require('url');

function getRouting (req, options) {
  const basePath = options.basePath || '';
  const method = req.method.toUpperCase();
  const uri = url.parse(req.url, true);
  const startBasePath = new RegExp('^/?' + basePath + '/?');
  const isBasePathMatch = uri.pathname.match(startBasePath);
  uri.pathname = uri.pathname.replace(startBasePath, '');

  return [method, uri, isBasePathMatch];
}

module.exports = { getRouting };
