const express = require('express');
const { getHost } = require('../util/getHost');
const errToMessages = require('../util/errToMessages');
const loginOptsWCreds = require('../util/loginOptsWCreds');
const removeUserDataFromSession = require('../util/removeUserDataFromSession');
const verifyCredential = require('../util/verifyCredential');
const updateSessionPrivileges = require('../util/updateSessionPrivileges');

module.exports = async function (hostIdentity, jwtSecret, account, isAdminLogin) {
  const rpID = hostIdentity;
  const sslEnabled = !/\blocalhost\b|\b127.0.0.1\b|\b10.0.0.2\b/.test(hostIdentity);
  const origin = sslEnabled ? `https://${rpID}` : `https://${rpID}`;

  const router = express.Router();

  router.get('/login',
    // csrfCheck,
    async (req, res) => {
      try {
        res.set('Cache-Control', 'no-store');
        if (!req.session.user) {
          removeUserDataFromSession(req.session);
        }

        const options = await loginOptsWCreds(req.session.user?.username, req.session.user, account, rpID, res.logNotes);
        req.session.loginChallenge = options.challenge; // Saves the challenge in the user session

        res.render('login/login.html', {
          title: isAdminLogin ? 'Start Admin Session' : 'Login',
          host: getHost(req),
          privileges: req.session.privileges || {},
          accountPrivileges: req.session.user?.privileges || {},
          message: 'select a passkey',
          options: JSON.stringify(options)
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
          message: 'Contact an admin if you need another invitation.'
        });
      }
    });

  router.post('/verify-authentication',
    // csrfCheck,
    express.json(),
    async (req, res) => {
      try {
        res.set('Cache-Control', 'no-store');
        if (!req.session.loginChallenge) {
          res.logNotes.add('no loginChallenge');
          res.status(401).json({ msg: 'Reload this page' });
          return;
        }

        const presentedCredential = req.body;
        const decodedUserId = Buffer.from(presentedCredential.response.userHandle, 'base64url').toString('utf8');
        const user = await account.getUser(decodedUserId, res.logNotes);

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
          return res.status(401).json({ msg: 'Your passkey could not be validated' });
        } else {
          return res.status(500).json({ msg: 'If this problem persists, contact an administrator.' });
        }
      }
    });

  router.get('/logout',
    // csrfCheck,
    async (req, res) => {
      try {
        res.logNotes.add(`${req.session.user?.username} ${req.session.user?.contactURL} logging out`);

        await new Promise((resolve, reject) => {
          req.session.destroy(err => { if (err) { reject(err); } else { resolve(); } });
        });

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
          message: 'Contact an admin if you need another invitation.'
        });
      }
    });

  return router;
};
