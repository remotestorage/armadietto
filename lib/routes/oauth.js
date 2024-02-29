/* eslint-env node */
/* eslint-disable camelcase */
const express = require('express');
const router = express.Router();
const formOrQueryData = require('../middleware/formOrQueryData');
const redirectToSSL = require('../middleware/redirectToSSL');
const validUser = require('../middleware/validUser');
const secureRequest = require('../middleware/secureRequest');
const { logRequest } = require('../logger');
const qs = require('querystring');

const accessStrings = { r: 'Read', rw: 'Read/write' };

router.get('/:username',
  redirectToSSL,
  formOrQueryData,
  validUser,
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
    logRequest(req, req.params.username, 200);
  });

router.post('/',
  secureRequest,
  formOrQueryData,
  validUser,
  validOAuthRequest,
  async function (req, res) {
    const locals = req.data;
    const username = locals.username.split('@')[0];
    const permissions = parseScope(locals.scope);

    if (locals.deny) {
      return error(req, res, 'access_denied', 'The user did not grant permission');
    }

    try {
      await req.app.get('streaming store').authenticate({ username, password: locals.password });
      req.session.permissions = permissions;
      const args = {
        access_token: req.sessionID,
        token_type: 'bearer',
        ...(locals.state && { state: locals.state })
      };
      redirect(req, res, args);
    } catch (error) {
      locals.title = 'Authorization Failure';
      locals.client_host = new URL(locals.redirect_uri).host;
      locals.error = error.message;
      locals.permissions = permissions;
      locals.access_strings = accessStrings;
      locals.state = locals.state || '';

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
    `${req.data.username} ${error_description} ${req.data.client_id}`);
}

function redirect (req, res, args, logNote) {
  const hash = qs.stringify(args);
  if (req.data.redirect_uri) {
    const location = req.data.redirect_uri + '#' + hash;
    res.redirect(location);

    if (logNote) {
      logRequest(req, req.data.username || '-', 302, 0, logNote, 'warning');
    } else {
      logRequest(req, req.data.username || '-', 302, 0, '-> ' + req.data.redirect_uri, 'notice');
    }
  } else {
    res.status(400).type('text/plain').send(hash);
    logRequest(req, req.data.username || '-', 400, hash.length,
      logNote || args?.error_description || 'no redirect_uri');
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
    if (pieces[0] === 'root') pieces[0] = '/';

    scopes[pieces[0]] = (pieces.length > 1)
      ? pieces.slice(1).join(':').split('')
      : ['r', 'w'];
  }
  return scopes;
}

module.exports = router;
