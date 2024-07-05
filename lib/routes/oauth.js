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
const { getHost } = require('../util/getHost');
const loginOptsWCreds = require('../util/loginOptsWCreds');
const verifyCredential = require('../util/verifyCredential');
const removeUserDataFromSession = require('../util/removeUserDataFromSession');
const updateSessionPrivileges = require('../util/updateSessionPrivileges');

const accessStrings = { r: 'Read', rw: 'Read/write' };

module.exports = function (hostIdentity, jwtSecret, account) {
  const rpID = hostIdentity;
  const sslEnabled = !/\blocalhost\b|\b127.0.0.1\b|\b10.0.0.2\b/.test(hostIdentity);
  const origin = sslEnabled ? `https://${rpID}` : `http://${rpID}`;

  const router = express.Router();
  router.get('/:username',
    redirectToSSL,
    formOrQueryData,
    sanityCheckUsername,
    validOAuthRequest,
    async function (req, res) {
      try {
        res.set('Cache-Control', 'no-store');

        const options = await loginOptsWCreds(req.params.username, req.session.user, account, rpID, res.logNotes);

        req.session.oauthParams = Object.assign(req.query, { username: req.params.username, challenge: options.challenge });
        res.render('auth-passkey.html', {
          title: 'Authorize',
          host: getHost(req),
          privileges: req.session.privileges || {},
          accountPrivileges: req.session.user?.privileges || {},
          client_host: req.query.redirect_uri ? new URL(req.query.redirect_uri).host : '[missing origin]',
          client_id: req.query.client_id,
          redirect_uri: req.query.redirect_uri,
          permissions: parseScope(req.query.scope || ''),
          username: req.params.username,
          options: JSON.stringify(options),
          access_strings: accessStrings
        });
      } catch (err) {
        delete req.session.oauthParams;
        removeUserDataFromSession(req.session);
        errToMessages(err, res.logNotes);
        res.status(401).render('login/error.html', {
          title: 'Authorization Error',
          host: getHost(req),
          privileges: req.session.privileges || {},
          accountPrivileges: req.session.user?.privileges || {},
          subtitle: '',
          message: 'Contact an admin if you need another invitation.'
        });
      }
    });

  router.post('/',
    secureRequest,
    formOrQueryData,
    async function (req, res) {
      try {
        res.set('Cache-Control', 'no-store');

        const presentedCredential = JSON.parse(req.body.credential);
        const user = await account.getUser(req.session.oauthParams.username, res.logNotes);

        await verifyCredential(user, req.session.oauthParams.challenge, origin, rpID, presentedCredential);
        await account.updateUser(user, res.logNotes);

        await updateSessionPrivileges(req, user, false);
        if (!req.session.privileges.STORE) {
          throw new Error('STORE privilege required to grant access');
        }

        let redirectOrigin;
        try {
          redirectOrigin = new URL(req.session.oauthParams.redirect_uri).origin;
        } catch (err) {
          throw new Error('Application origin is bad', { cause: err });
        }

        const scopes = req.session.oauthParams.scope.split(/\s+/).map(scope => {
          scope = scope.replace(/[^\w*:]/g, '').toLowerCase();
          if (scope.endsWith(':r') || scope.endsWith(':rw')) {
            return scope;
          } else {
            return scope + ':rw';
          }
        }).join(' ');
        const grantDuration = (req.body.grantDuration?.trim() || '7') + 'd';
        const token = jwt.sign(
          { scopes },
          jwtSecret,
          { algorithm: 'HS512', issuer: hostIdentity, audience: redirectOrigin, subject: req.session.oauthParams.username, expiresIn: grantDuration }
        );
        res.logNotes.add(`created JWT for ${req.session.oauthParams.username} on ${redirectOrigin} w/ scope ${scopes} for ${grantDuration}`);
        const args = {
          access_token: token,
          token_type: 'bearer',
          ...(req.session.oauthParams.state && { state: req.session.oauthParams.state })
        };
        redirect(req, res, req.session.oauthParams.redirect_uri, args);
      } catch (error) {
        errToMessages(error, res.logNotes);
        res.status(401).render('auth-passkey.html', {
          title: 'Authorization Failure',
          host: getHost(req),
          privileges: req.session.privileges || {},
          accountPrivileges: req.session.user?.privileges || {},
          error: error.message,
          client_host: req.session.oauthParams?.redirect_uri ? new URL(req.session.oauthParams?.redirect_uri).host : '[missing origin]',
          client_id: req.session.oauthParams?.client_id,
          redirect_uri: req.session.oauthParams?.redirect_uri,
          permissions: parseScope(req.session.oauthParams?.scope || ''),
          username: req.session.oauthParams?.username,
          options: JSON.stringify({}),
          access_strings: accessStrings
        });
        removeUserDataFromSession(req.session);
      } finally {
        delete req.session.oauthParams; // Kills the challenge for this session.
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
    redirect(req, res, req.data.redirect_uri, { error, error_description },
      `${error_description} ${req.data.client_id}`);
  }

  function redirect (req, res, redirect_uri, args, logNote) {
    const hash = qs.stringify(args);
    if (redirect_uri) {
      const location = redirect_uri + '#' + hash;

      if (logNote) {
        res.logNotes.add(logNote);
        res.logLevel = 'warning';
      } else {
        res.logNotes.add('-> ' + redirect_uri);
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
