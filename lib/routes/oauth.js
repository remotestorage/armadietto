/* eslint-env node */
/* eslint-disable camelcase */
const errToMessages = require('../util/errToMessages');
const express = require('express');
const formOrQueryData = require('../middleware/formOrQueryData');
const redirectToSSL = require('../middleware/redirectToSSL');
const sanityCheckUsername = require('../middleware/sanityCheckUsername');
const secureRequest = require('../middleware/secureRequest');
const jwt = require('jsonwebtoken');
const qs = require('querystring');

const accessStrings = { r: 'Read', rw: 'Read/write' };

module.exports = function (hostIdentity, jwtSecret) {
  const router = express.Router();
  router.get('/:username',
    redirectToSSL,
    formOrQueryData,
    sanityCheckUsername,
    validOAuthRequest,
    function (req, res) {
      res.render('auth.html', {
        title: 'Authorize',
        client_host: new URL(req.query.redirect_uri).host,
        client_id: req.query.client_id,
        redirect_uri: req.query.redirect_uri,
        response_type: req.query.response_type,
        scope: req.query.scope || '',
        state: req.query.state || '',
        permissions: parseScope(req.query.scope || ''),
        username: req.params.username,
        access_strings: accessStrings
      });
    });

  router.post('/',
    secureRequest,
    formOrQueryData,
    sanityCheckUsername,
    validOAuthRequest,
    async function (req, res) {
      const locals = req.data;
      const username = locals.username.split('@')[0];

      if (locals.deny) {
        return error(req, res, 'access_denied', 'The user did not grant permission to');
      }

      try {
        await req.app.get('account').authenticate({ username, password: locals.password }, res.logNotes);
        let redirectOrigin;
        try {
          redirectOrigin = new URL(req.data.redirect_uri).origin;
        } catch (err) {
          throw new Error('Application origin is bad', { cause: err });
        }

        const scopes = req.data.scope.split(/\s+/).map(scope => {
          scope = scope.replace(/[^\w*:]/g, '').toLowerCase();
          if (scope.endsWith(':r') || scope.endsWith(':rw')) {
            return scope;
          } else {
            return scope + ':rw';
          }
        }).join(' ');
        const token = jwt.sign(
          { scopes },
          jwtSecret,
          { algorithm: 'HS512', issuer: hostIdentity, audience: redirectOrigin, subject: username, expiresIn: '30d' }
        );
        res.logNotes.add(`created JWT for ${username} on ${redirectOrigin} w/ scope ${locals.scope}`);
        const args = {
          access_token: token,
          token_type: 'bearer',
          ...(locals.state && { state: locals.state })
        };
        redirect(req, res, args);
      } catch (error) {
        locals.title = 'Authorization Failure';
        locals.client_host = locals.redirect_uri ? new URL(locals.redirect_uri).host : '[missing origin]';
        locals.error = error.message;
        locals.permissions = parseScope(locals.scope);
        locals.access_strings = accessStrings;
        locals.state = locals.state || '';

        errToMessages(error, res.logNotes);
        res.status(401).render('auth.html', locals);
      }
    }
  );

  function validOAuthRequest (req, res, next) {
    if (!req.data.client_id) {
      return error(req, res, 'invalid_request', 'Required parameter "client_id" is missing');
    }
    if (!req.data.response_type) {
      return error(req, res, 'invalid_request', 'Required parameter "response_type" is missing');
    }
    if (!req.data.scope) {
      return error(req, res, 'invalid_scope', 'Parameter "scope" is invalid');
    }
    if (!req.data.redirect_uri) {
      return error(req, res, 'invalid_request', 'Required parameter "redirect_uri" is missing');
    }
    const uri = new URL(req.data.redirect_uri);
    if (!uri.protocol || !uri.hostname) {
      return error(req, res, 'invalid_request', 'Parameter "redirect_uri" must be a valid URL');
    }

    if (req.data.response_type !== 'token') {
      return error(req, res, 'unsupported_response_type', 'Response type "' + req.data.response_type + '" is not supported');
    }

    next();
  }

  function error (req, res, error, error_description) {
    redirect(req, res, { error, error_description },
      `${error_description} ${req.data.client_id}`);
  }

  function redirect (req, res, args, logNote) {
    const hash = qs.stringify(args);
    if (req.data.redirect_uri) {
      const location = req.data.redirect_uri + '#' + hash;

      if (logNote) {
        res.logNotes.add(logNote);
        res.logLevel = 'warning';
      } else {
        res.logNotes.add('-> ' + req.data.redirect_uri);
        res.logLevel = 'notice';
      }
      res.redirect(location);
    } else {
      res.logNotes.add(logNote || args?.error_description || 'no redirect_uri');
      res.status(400).type('text/plain').send(hash);
    }
  }

  // OAuth.prototype.accessStrings = {r: 'Read', rw: 'Read/write'};
  function parseScope (scope) {
    const parts = scope.split(/\s+/);
    const scopes = {};
    let pieces;

    for (let i = 0, n = parts.length; i < n; i++) {
      pieces = parts[i].split(':');
      pieces[0] = pieces[0].replace(/(.)\/*$/, '$1');

      scopes[pieces[0]] = (pieces.length > 1)
        ? pieces.slice(1).join(':').split('')
        : ['r', 'w'];
    }
    return scopes;
  }

  return router;
};
