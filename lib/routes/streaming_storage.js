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
const { pipeline } = require('node:stream/promises');

// const accessStrings = { r: 'Read', rw: 'Read/write' };

router.options('/:username/*',
  cacheControl,
  ourCors
);

/** Express uses GET to generate head */
router.get('/:username/*',
  cacheControl,
  ourCors,
  validUserParam,
  validPathParam,
  checkToken.bind(null, 'r'),
  async function (req, res, next) {
    try {
      let condition;
      if (req.get('If-Match')) {
        condition = { name: 'If-Match', ETag: req.get('If-Match') };
      } else if (req.get('If-None-Match')) {
        condition = { name: 'If-None-Match', ETag: req.get('If-None-Match') };
      }
      const { status, readStream, contentLength, contentType, ETag } = await req.app.get('streaming store').get(req.params.username, req.blobPath, condition);
      switch (status) {
        case 200:
          res.status(status).set('Content-Length', contentLength).set('Content-Type', contentType).set('ETag', ETag);
          return pipeline(readStream, res);
        case 304: // Not Modified
          return res.status(status).set('Content-Length', contentLength).set('Content-Type', contentType).set('ETag', ETag).end();
        case 404:
          return next(Object.assign(new Error(`No file exists at path “${req.blobPath}”`), { status: 404 }));
        case 409: // Conflict
        case 502: // Bad Gateway (S3 issue)
        default:
          res.status(status).end();
      }
    } catch (err) { // Express v5 will propagate rejected promises automatically.
      next(err);
    }
  }
);

router.put('/:username/*',
  ourCors,
  noRanges,
  validUserParam,
  validPathParam,
  checkToken.bind(null, 'w'),
  async function (req, res, next) {
    try {
      const contentType = req.get('Content-Type') || 'application/binary';
      const contentLength = req.get('Content-Length') ? parseInt(req.get('Content-Length')) : null;
      let condition;
      if (req.get('If-Match')) {
        condition = { name: 'If-Match', ETag: req.get('If-Match') };
      } else if (req.get('If-None-Match')) {
        condition = { name: 'If-None-Match', ETag: req.get('If-None-Match') };
      }
      const [result, ETag] = await req.app.get('streaming store').put(req.params.username, req.blobPath, contentType, contentLength, req, condition);
      if (ETag) {
        res.set('ETag', ETag);
      }
      switch (result) {
        case 'CREATED':
          res.status(201).end();
          break;
        case 'UPDATED':
          res.status(204).end();
          break;
        case 'CONFLICT':
          res.status(409).end();
          break;
        case 'PRECONDITION FAILED':
          res.status(412).end();
          break;
        case 'TIMEOUT':
          res.status(504).end();
          break;
        default:
          next(new Error('result of store is unknown'));
      }
    } catch (err) { // Express v5 will propagate rejected promises automatically.
      next(err);
    }
  }
);

router.delete('/:username/*',
  ourCors,
  validUserParam,
  validPathParam,
  checkToken.bind(null, 'w'),
  async function (req, res, next) {
    try {
      let condition = null;
      if (req.get('If-Match')) {
        condition = { name: 'If-Match', ETag: req.get('If-Match') };
      } else if (req.get('If-None-Match')) {
        condition = { name: 'If-None-Match', ETag: req.get('If-None-Match') };
      }
      const [result, ETag] = await req.app.get('streaming store').delete(req.params.username, req.blobPath, condition);
      if (ETag) {
        res.set('ETag', ETag);
      }
      switch (result) {
        case 'DELETED':
          res.status(204).end();
          break;
        case 'NOT FOUND':
          res.status(404).end();
          break;
        case 'PRECONDITION FAILED':
          res.status(412).end();
          break;
        default:
          next(new Error('result of store is unknown'));
      }
    } catch (err) { // Express v5 will propagate rejected promises automatically.
      next(err);
    }
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

  const permissions = await req.app.get('streaming store').permissions(req.params.username, req.token);
  if (!permissions) {
    return unauthorized(req, res, 401, 'invalid_token');
  }

  const blobPathComponents = req.blobPath?.split('/');
  const scopeName = blobPathComponents[1] === 'public' ? blobPathComponents[2] : blobPathComponents[1];
  const scope = '/' + (scopeName ? scopeName + '/' : '');
  const scopePermissions = permissions[scope] || [];
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
