/* eslint-env node */
/* eslint-disable camelcase */
const express = require('express');
const router = express.Router();
const cors = require('cors');
const ourCors = cors({ allowedHeaders: 'Content-Type, Authorization, Content-Length, If-Match, If-None-Match, Origin, X-Requested-With', methods: 'GET, HEAD, PUT, DELETE', exposedHeaders: 'ETag', maxAge: 7200 });
const isSecureRequest = require('../util/isSecureRequest');
const { logRequest } = require('../logger');
const { getHost } = require('../util/getHost');
const core = require('../stores/core');

// const accessStrings = { r: 'Read', rw: 'Read/write' };

router.options('/:username/*',
  cacheControl,
  ourCors
);

/** Express uses GET to generate HEAD */
router.get('/:username/*',
  cacheControl,
  ourCors,
  validUserParam,
  validPathParam,
  checkToken.bind(null, 'r'),
  async function (_req, _res, next) {
    next();
  }
);

router.put('/:username/*',
  ourCors,
  noRanges,
  validUserParam,
  validPathParam,
  checkToken.bind(null, 'w'),
  async function (_req, _res, next) {
    next();
  }
);

router.delete('/:username/*',
  ourCors,
  validUserParam,
  validPathParam,
  checkToken.bind(null, 'w'),
  async function (_req, _res, next) {
    next();
  }
);

function cacheControl (req, res, next) {
  res.set('Cache-Control', 'private, no-cache');
  next();
}

function validUserParam (req, res, next) {
  if (core.isValidUsername(req.params.username)) { return next(); }

  res.status(400).type('text/plain').end();

  logRequest(req, req.params.username, 400, 0, 'invalid user');
}

function validPathParam (req, res, next) {
  req.blobPath = req.url.slice(1 + req.params.username.length);
  if (core.VALID_PATH.test(req.blobPath)) {
    return next();
  }

  res.status(400).type('text/plain').end();

  logRequest(req, req.params.username, 400, 0, 'invalid user');
}

async function checkToken (permission, req, res, next) {
  req.token = decodeURIComponent(req.get('Authorization')).split(/\s+/)[1];
  // providing the access token via a HTTP query parameter
  //     for GET requests MAY be supported by the server, although its use
  //     is not recommended, due to its security deficiencies
  // req.token = req.get('Authorization')
  //   ? decodeURIComponent(req.get('Authorization')).split(/\s+/)[1]
  //   : req.data.access_token || req.data.oauth_token;

  if (req.app.get('forceSSL') && !isSecureRequest(req)) {
    delete req.session.permissions;
    return unauthorized(req, res, 400, 'invalid_request', 'HTTPS required');
  }

  const isDir = /\/$/.test(req.blobPath);
  const isPublic = req.blobPath?.startsWith('/public/');
  // const isPublic = /^\/public\//.test(req.blobPath);

  if (permission === 'r' && isPublic && !isDir) { return next(); }

  // const permissions = await req.app.get('account').permissions(req.params.username, req.token);
  if (!req.session?.permissions) {
    return unauthorized(req, res, 401, 'invalid_token');
  }

  const blobPathComponents = req.blobPath?.split('/');
  const scopeName = blobPathComponents[1] === 'public' ? blobPathComponents[2] : blobPathComponents[1];
  const scope = '/' + (scopeName ? scopeName + '/' : '');
  const scopePermissions = req.session?.permissions[scope] || [];
  if (scopePermissions.indexOf(permission) < 0) {
    return unauthorized(req, res, 403, 'insufficient_scope', `user has permissions '${JSON.stringify(scopePermissions)}' but lacks '${permission}'`);
  }
  if (permission === 'w' && isDir) {
    res.status(400).end();
    return logRequest(req, req.params.username, 400, 0, 'can\'t write to directory');
  }
  next();
}

function noRanges (req, res, next) {
  if (req.get('Content-Range')) {
    const msg = 'Content-Range not allowed in PUT';
    res.status(400).type('text/plain').send(msg);
    logRequest(req, req.params.username, 400, msg.length, msg);
  } else {
    next();
  }
}

/**
 * Renders error response
 * @param {http.ClientRequest} req
 * @param {http.ServerResponse} res
 * @param {number} status - HTTP status
 * @param {string} errMsg - OAUTH code: invalid_request, access_denied, invalid_scope, etc.
 * @param {string|Error} [logMsg] - should concisely give details & be distinct from other calls
 */
function unauthorized (req, res, status, errMsg, logMsg) {
  const realm = getHost(req);
  res.set('WWW-Authenticate', `Bearer realm="${realm}" error="${errMsg}"`);
  res.status(status).end();
  logRequest(req, req.params.username, status, 0, logMsg || errMsg || '');
}

module.exports = router;
