/* eslint-env node */
/* eslint-disable camelcase */
const express = require('express');
const { corsAllowPrivate, corsRS } = require('../util/corsMiddleware');
const sanityCheckUsername = require('../middleware/sanityCheckUsername');
const isSecureRequest = require('../util/isSecureRequest');
const { expressjwt: jwt } = require('express-jwt');
const { getHost } = require('../util/getHost');
const { POINTS_AUTH_REQUEST, POINTS_UNAUTH_REQUEST, rateLimiterReward, rateLimiterPenalty } = require('../middleware/rateLimiterMiddleware');

module.exports = function (hostIdentity, jwtSecret) {
  const router = express.Router();
  const jwtCredentials = jwt({
    secret: jwtSecret,
    algorithms: ['HS512'],
    issuer: hostIdentity,
    // audience: req.get('Origin'),
    // subject: user.username,
    maxAge: '30d',
    credentialsRequired: false // public documents & permission checking
  });

  router.options('/:username/*',
    (_req, res, next) => { res.logLevel = 'debug'; next(); },
    corsAllowPrivate,
    corsRS
  );

  /** Express uses GET to generate HEAD */
  router.get('/:username/*',
    corsAllowPrivate,
    corsRS,
    sanityCheckUsername,
    validPathParam,
    (req, res, next) => {
      if (req.blobPath?.startsWith('public/') && !req.blobPath.endsWith('/')) {
        res.set('Cache-Control', 'public, no-cache');
        next('route'); // allows access without checking JWT
      } else {
        res.set('Cache-Control', 'private, no-cache');
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

  async function validPathParam (req, res, next) {
    req.blobPath = req.params[0];
    const path = req.blobPath.endsWith('/') ? req.blobPath.slice(0, -1) : req.blobPath;
    if (path.length > 0) {
      for (const segment of path.split('/')) {
        if (segment.length === 0 || /^\.+$|\0/.test(segment)) {
          await rateLimiterPenalty(req.ip, POINTS_UNAUTH_REQUEST);
          res.logNotes.add('invalid path');
          res.status(400).end();
          return;
        }
      }
    }
    next();
  }

  async function validWritePath (req, res, next) {
    if (req.blobPath.endsWith('/')) {
      await rateLimiterPenalty(req.ip, POINTS_UNAUTH_REQUEST);
      res.logNotes.add('can\'t write to folder');
      res.status(400).type('text/plain').send('can\'t write to folder');
    } else {
      next();
    }
  }

  async function jwtErrors (err, req, res, next) {
    await rateLimiterPenalty(req.ip, 2 * POINTS_UNAUTH_REQUEST);
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

      if (req.auth.sub !== req.params.username) {
        return unauthorized(req, res, 401, 'invalid_token', requiredScope, `granted for user ${req.auth.sub}, but asking for req.params.username`);
      }
      if (req.auth.aud !== req.headers.origin) {
        return unauthorized(req, res, 401, 'invalid_token', requiredScope, `granted for ${req.auth.aud}, but origin is ${req.headers.origin}`);
      }
      const grantedScopes = req.auth?.scopes;
      if (!grantedScopes) {
        return unauthorized(req, res, 401, 'invalid_token', requiredScope, 'no scopes granted');
      }

      if (grantedScopes?.split(/\s+/).some(scope => {
        const grantedParts = scope.split(':');
        return [requiredScopeName, '*'].includes(grantedParts[0]) && grantedParts[1].startsWith(requiredPermission);
      })) {
        // refunds the points consumed by rate-limiter middleware
        rateLimiterReward(req.ip, POINTS_UNAUTH_REQUEST - POINTS_AUTH_REQUEST);
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
  async function unauthorized (req, res, status, errMsg, requiredScope, logMsg) {
    await rateLimiterPenalty(req.ip, POINTS_UNAUTH_REQUEST);
    const value = `Bearer realm="${getHost(req)}" scope="${requiredScope}"` + (errMsg ? ` error="${errMsg}"` : '');
    res.set('WWW-Authenticate', value);
    res.logNotes.add(logMsg || errMsg);
    res.status(status).end();
  }

  return router;
};
