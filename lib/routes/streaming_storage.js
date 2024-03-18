/* eslint-env node */
/* eslint-disable camelcase */
const express = require('express');
const cors = require('cors');
const isSecureRequest = require('../util/isSecureRequest');
const { expressjwt: jwt } = require('express-jwt');
const { logRequest } = require('../logger');
const { getHost } = require('../util/getHost');
const core = require('../stores/core');

module.exports = function (secret) {
  const router = express.Router();
  const ourCors = cors({ origin: true, allowedHeaders: 'Content-Type, Authorization, Content-Length, If-Match, If-None-Match, Origin, X-Requested-With', methods: 'GET, HEAD, PUT, DELETE', exposedHeaders: 'ETag', maxAge: 7200 });
  const jwtCredentials = jwt({
    secret,
    algorithms: ['HS256'],
    // issuer: app.locals.host, // TODO: should be name of server (as set in config)
    // audience: req.get('Origin'),
    // subject: username,
    maxAge: '30d',
    credentialsRequired: false // public documents & permission checking
  });

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
    (req, res, next) => {
      if (req.blobPath?.startsWith('/public/') && !req.blobPath.endsWith('/')) {
        res.set('Cache-Control', 'no-cache, public');
        next('route'); // allows access without checking JWT
      } else {
        next();
      }
    },
    jwtCredentials,
    jwtErrors,
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
    validWritePath,
    jwtCredentials,
    jwtErrors,
    checkToken.bind(null, 'w'),
    async function (_req, _res, next) {
      next();
    }
  );

  router.delete('/:username/*',
    ourCors,
    validUserParam,
    validPathParam,
    validWritePath,
    jwtCredentials,
    jwtErrors,
    checkToken.bind(null, 'w'),
    async function (_req, _res, next) {
      next();
    }
  );

  function cacheControl (req, res, next) {
    res.set('Cache-Control', 'no-cache');
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

    logRequest(req, req.params.username, 400, 0, 'invalid path');
  }

  function validWritePath (req, res, next) {
    if (req.blobPath.endsWith('/')) {
      res.status(400).end();
      return logRequest(req, req.params.username, 400, 0, 'can\'t write to directory');
    } else {
      next();
    }
  }

  function jwtErrors (err, req, res, next) {
    if (Number.isInteger(err.status)) {
      const blobPathComponents = req.blobPath?.split('/');
      const requiredScopeName = (blobPathComponents[1] === 'public' ? blobPathComponents[2] : blobPathComponents[1]) || 'root';
      const requiredScope = requiredScopeName + (['PUT', 'DELETE'].includes(req.method) ? ':rw' : ':r');
      res.setHeader('WWW-Authenticate', `Bearer realm="${getHost(req)}" scope="${requiredScope}" error="${err.code}" token_type="JWT"`);
      res.status(err.status).end();
    } else {
      next(err);
    }
  }

  async function checkToken (permission, req, res, next) {
    try {
      const blobPathComponents = req.blobPath?.split('/');
      const requiredScopeName = (blobPathComponents[1] === 'public' ? blobPathComponents[2] : blobPathComponents[1]) || 'root';
      const requiredPermission = permission === 'w' ? 'rw' : 'r';
      const requiredScope = requiredScopeName + ':' + requiredPermission;

      if (req.app.get('forceSSL') && !isSecureRequest(req)) {
        // TODO: revoke JWT?
        return unauthorized(req, res, 400, 'invalid_request', requiredScope, 'HTTPS required');
      }

      if (!req.auth) { // request was sent without authentication
        return unauthorized(req, res, 401, '', requiredScope);
      }

      if (req.auth.sub !== req.params.username || req.auth.aud !== req.headers.origin) {
        return unauthorized(req, res, 401, 'invalid_token', requiredScope);
      }

      const grantedScopes = req.auth?.scopes;
      if (!grantedScopes) {
        return unauthorized(req, res, 401, 'invalid_token', requiredScope);
      }

      if (grantedScopes?.split(/\s+/).some(scope => {
        const grantedParts = scope.split(':');
        return [requiredScopeName, 'root'].includes(grantedParts[0]) && grantedParts[1].startsWith(requiredPermission);
      })) {
        next();
      } else {
        return unauthorized(req, res, 403, 'insufficient_scope', requiredScope, `user has permissions '${grantedScopes}' but lacks '${requiredScope}'`);
      }
    } catch (err) {
      next(err);
    }
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
   * @param {string} requiredScope - required scope that was not granted
   * @param {string|Error} [logMsg] - should concisely give details & be distinct from other calls
   */
  function unauthorized (req, res, status, errMsg, requiredScope, logMsg) {
    const value = `Bearer realm="${getHost(req)}" scope="${requiredScope}"` + (errMsg ? ` error="${errMsg}"` : '');
    res.set('WWW-Authenticate', value);
    res.status(status).end();
    logRequest(req, req.params.username, status, 0, logMsg || errMsg || '');
  }

  return router;
};
