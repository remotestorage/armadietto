const express = require('express');
const { getHost } = require('../util/getHost');
const errToMessages = require('../util/errToMessages');
const loginOptsWCreds = require('../util/loginOptsWCreds');
const removeUserDataFromSession = require('../util/removeUserDataFromSession');
const verifyCredential = require('../util/verifyCredential');
const updateSessionPrivileges = require('../util/updateSessionPrivileges');
const { rateLimiterPenalty } = require('../middleware/rateLimiterMiddleware');

module.exports = async function (hostIdentity, jwtSecret, account, isAdminLogin) {
  const rpID = hostIdentity;
  const sslEnabled = !/\blocalhost\b|\b127.0.0.1\b|\b10.0.0.2\b/.test(hostIdentity);
  const origin = sslEnabled ? `https://${rpID}` : `https://${rpID}`;

  const router = express.Router();

  router.get('/login',
    // csrfCheck,
    async (req, res) => {
      try {
        if (!req.session.user) {
          removeUserDataFromSession(req.session);
        }

        const options = await loginOptsWCreds(req.session.user?.username, req.session.user, account, rpID, res.logNotes);
        req.session.loginChallenge = options.challenge; // Saves the challenge in the user session

        res.set('Cache-Control', 'private, no-store');
        res.render('login/login.html', {
          title: isAdminLogin ? 'Start Admin Session' : 'Login',
          host: getHost(req),
          privileges: req.session.privileges || {},
          accountPrivileges: req.session.user?.privileges || {},
          message: isAdminLogin ? 'Click the button below to authenticate with a passkey.' : 'Click the button below to log in with a passkey.\n\nIf you need to create a passkey for this device or browser, log in from your old device and invite yourself to create a new passkey.',
          options: JSON.stringify(options),
          actionLabel: isAdminLogin ? 'Authenticate' : 'Log in'
        });
      } catch (err) {
        removeUserDataFromSession(req.session);
        errToMessages(err, res.logNotes);
        res.status(401).render('login/error.html', {
          title: 'Login Error',
          host: getHost(req),
          privileges: req.session.privileges || {},
          accountPrivileges: req.session.user?.privileges || {},
          subtitle: '',
          message: 'If you need to create a passkey for this device or browser, log in from your old device and invite yourself to create a new passkey..'
        });
      }
    });

  router.post('/verify-authentication',
    // csrfCheck,
    express.json(),
    async (req, res) => {
      try {
        if (!req.session.loginChallenge) {
          res.logNotes.add('no loginChallenge in session');
          res.status(401).json({ msg: 'Reload this page — your session expired' });
          return;
        }

        const presentedCredential = req.body;
        const username = presentedCredential.response.userHandle
          ? Buffer.from(presentedCredential.response.userHandle, 'base64url').toString('utf8')
          : req.session.user?.username;
        const user = await account.getUser(username, res.logNotes); // always loads latest values

        await verifyCredential(user, req.session.loginChallenge, origin, rpID, presentedCredential);
        delete req.session.loginChallenge; // Kills the challenge for this session.

        await account.updateUser(user, res.logNotes);

        await updateSessionPrivileges(req, user, isAdminLogin);
        res.logNotes.add(`${user?.username} ${user?.contactURL} logged in with ${Object.keys(req.session.privileges || {}).join('&')}`);

        req.session.user = user;
        return res.json({ verified: true, username: user.username });
      } catch (err) {
        delete req.session.loginChallenge;
        removeUserDataFromSession(req.session);

        errToMessages(err, res.logNotes);
        if (['Error', 'NoSuchUserError'].includes(err.name)) {
          res.status(401).json({ msg: 'Your passkey could not be validated' });
        } else {
          res.status(500).json({ msg: 'If this problem persists, contact an administrator.' });
        }
        await rateLimiterPenalty(req.ip);
      }
    });

  /** TODO: make this a POST, and change link to form */
  router.get('/logout',
    // csrfCheck,
    async (req, res) => {
      try {
        res.logNotes.add(`${req.session.user?.username} ${req.session.user?.contactURL} logging out`);

        await new Promise((resolve, reject) => {
          req.session.destroy(err => { if (err) { reject(err); } else { resolve(); } });
        });

        res.set('Cache-Control', 'private, no-store');
        res.render('login/logout.html', {
          title: 'Logged Out',
          host: getHost(req),
          privileges: {},
          accountPrivileges: {}
        });
      } catch (err) {
        errToMessages(err, res.logNotes);
        res.status(401).render('login/error.html', {
          title: 'Logout Error',
          host: getHost(req),
          privileges: {},
          accountPrivileges: {},
          subtitle: '',
          message: 'If you need to create a passkey for this device or browser, log in from your old device and invite yourself to create a new passkey..'
        });
      }
    });

  return router;
};
