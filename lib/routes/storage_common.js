/* eslint-env node */
/* eslint-disable camelcase */
const express = require('express');
const { corsAllowPrivate, corsRS } = require('../util/corsMiddleware');
const sanityCheckUsername = require('../middleware/sanityCheckUsername');
const isSecureRequest = require('../util/isSecureRequest');
const { expressjwt: jwt } = require('express-jwt');
const { getHost } = require('../util/getHost');

module.exports = function (hostIdentity, jwtSecret) {
  const router = express.Router();
  const jwtCredentials = jwt({
    secret: jwtSecret,
    algorithms: ['HS512'],
    issuer: hostIdentity,
    // audience: req.get('Origin'),
    // subject: username,
    maxAge: '30d',
    credentialsRequired: false // public documents & permission checking
  });

  router.options('/:username/*',
    (_req, res, next) => { res.logLevel = 'debug'; next(); },
    cacheControl,
    corsAllowPrivate,
    corsRS
  );

  /** Express uses GET to generate HEAD */
  router.get('/:username/*',
    cacheControl,
    corsAllowPrivate,
    corsRS,
    sanityCheckUsername,
    validPathParam,
    (req, res, next) => {
      if (req.blobPath?.startsWith('public/') && !req.blobPath.endsWith('/')) {
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
    corsAllowPrivate,
    corsRS,
    noRanges,
    sanityCheckUsername,
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
    corsAllowPrivate,
    corsRS,
    sanityCheckUsername,
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

  function validPathParam (req, res, next) {
    req.blobPath = req.params[0];
    const path = req.blobPath.endsWith('/') ? req.blobPath.slice(0, -1) : req.blobPath;
    if (path.length > 0) {
      for (const segment of path.split('/')) {
        if (segment.length === 0 || /^\.+$|\0/.test(segment)) {
          res.logNotes.add('invalid path');
          res.status(400).end();
          return;
        }
      }
    }
    next();
  }

  function validWritePath (req, res, next) {
    if (req.blobPath.endsWith('/')) {
      res.logNotes.add('can\'t write to folder');
      res.status(400).type('text/plain').send('can\'t write to folder');
    } else {
      next();
    }
  }

  function jwtErrors (err, req, res, next) {
    if (Number.isInteger(err.status)) {
      const blobPathComponents = req.blobPath?.split('/');
      const requiredScopeName = (blobPathComponents[1] === 'public' ? blobPathComponents[2] : blobPathComponents[1]) || '*';
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
      const requiredScopeName = (blobPathComponents[0] === 'public' ? blobPathComponents[1] : blobPathComponents[0]) || '*';
      const requiredPermission = permission === 'w' ? 'rw' : 'r';
      const requiredScope = requiredScopeName + ':' + requiredPermission;

      if (req.app.get('forceSSL') && !isSecureRequest(req)) {
        // TODO: revoke JWT?
        return unauthorized(req, res, 400, 'invalid_request', requiredScope, 'HTTPS required');
      }

      if (!req.auth) { // request was sent without authentication
        return unauthorized(req, res, 401, '', requiredScope, 'no authentication');
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
        return [requiredScopeName, '*'].includes(grantedParts[0]) && grantedParts[1].startsWith(requiredPermission);
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
      res.logNotes.add(msg);
      res.status(400).type('text/plain').send(msg);
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
    res.logNotes.add(logMsg || errMsg);
    res.status(status).end();
  }

  return router;
};
