const process = require('process');
const { getLogger } = require('../logger');
const errToMessages = require('../util/errToMessages');
const crypto = require('crypto');
const express = require('express');
const { getHost } = require('../util/getHost');
const path = require('path');
const YAML = require('yaml');
const { generateRegistrationOptions, verifyRegistrationResponse } = require('@simplewebauthn/server');
const useragent = require('express-useragent');
const { initProtocols, assembleContactURL, calcContactURL, protocolOptions } = require('../util/protocols');
const nameFromUseragent = require('../util/nameFromUseragent');
const removeUserDataFromSession = require('../util/removeUserDataFromSession');
const ParameterError = require('../util/ParameterError');

/* eslint no-unused-vars: ["warn", { "varsIgnorePattern": "^_", "argsIgnorePattern": "^_" }]  */
/* eslint-disable no-case-declarations */

const INVITE_REQUEST_DIR = 'inviteRequests';
const INVITE_DIR_NAME = 'invites';
const CONTACT_URL_DIR = 'contactUrls';
const INVITE_DURATION = 42 * 60 * 60 * 1000; // The user may not be expecting the invite.

module.exports = async function (hostIdentity, jwtSecret, accountMgr, storeRouter) {
  const rpName = hostIdentity;
  const rpID = hostIdentity;
  const sslEnabled = !/\blocalhost\b|\b127.0.0.1\b|\b10.0.0.2\b/.test(hostIdentity);
  const origin = sslEnabled ? `https://${rpID}` : `https://${rpID}`;

  const router = express.Router();

  // ----------------------- invitations ----------------------------------

  router.get('/acceptInvite',
    // csrfCheck,
    loadAdmin,
    async (req, res) => {
      res.set('Cache-Control', 'private, no-store'); // set this because this request can't be a POST
      try {
        res.logNotes.add(`user ${req.session.user?.username || '«new»'} redeeming ${req.query?.token} "${req.session.user?.contactURL}"`);

        res.status(200).render('admin/invite-valid.html', {
          title: req.session.user?.username ? `Welcome, ${req.session.user.username}!` : 'Welcome!',
          host: getHost(req),
          privileges: req.session.privileges || {},
          accountPrivileges: req.session.user?.privileges || {},
          username: req.session.user?.username,
          contactURL: req.session.user?.contactURL,
          message: req.session.user?.username ? 'Create a passkey' : 'Pick a username',
          options: ''
        });
      } catch (err) {
        removeUserDataFromSession(req.session);
        errToMessages(err, res.logNotes);
        res.status(401).render('login/error.html', {
          title: 'Your invitation has expired or is not valid',
          host: getHost(req),
          privileges: req.session.privileges || {},
          accountPrivileges: req.session.user?.privileges || {},
          subtitle: '(or there was an error)',
          message: 'Log in from your old device and invite yourself to create a new passkey.'
        });
      }
    }
  );

  router.post('/getRegistrationOptions',
    // csrfCheck,
    express.json(),
    async (req, res) => {
      try {
        let isCreate = false;
        let user = req.session.user;
        if (!user) { throw new Error('Reload this page or request another invite'); }

        const newUsername = req.body.username?.trim();
        if (newUsername) { user.username = newUsername; }
        if (!user.username) { throw new ParameterError('username is required'); }
        await storeRouter.upsertAdminBlob(path.join(CONTACT_URL_DIR, encodeURIComponent(user.contactURL) + '.yaml'), 'application/yaml', user.username);

        if (req.session.isUserSynthetic) {
          user = await accountMgr.createUser(user, res.logNotes);
          delete req.session.isUserSynthetic;
          res.logNotes.add(`created user ${user.username} "${user.contactURL}" with privileges ${Object.keys(user.privileges).join('&')}`);
          isCreate = true;
        }

        const excludeCredentials = Object.values(user?.credentials || {}).map(credential => ({
          id: Buffer.from(credential.credentialID, 'base64url'),
          type: 'public-key',
          transports: credential.transports // Optional
        }));
        const options = await generateRegistrationOptions({
          rpName,
          rpID,
          userID: Buffer.from(user.username, 'utf8').toString('base64url'),
          userName: user.username,
          userDisplayName: user.username,
          attestationType: 'none', // Don't prompt users for additional information (Recommended for smoother UX)
          excludeCredentials, // Prevents users from re-registering existing credentials
          authenticatorSelection: { // See "Guiding use of authenticators via authenticatorSelection" below
            residentKey: 'preferred', // resident keys are discoverable
            userVerification: 'preferred' // Typically requires biometric, but not password.
            // no value for authenticatorAttachment to allow both platform & cross-platform
          }
        });

        req.session.regChallenge = options.challenge;

        res.status(isCreate ? 201 : 200).json(options);
      } catch (err) {
        if (!['ParameterError'].includes(err.name)) {
          removeUserDataFromSession(req.session);
        }
        errToMessages(err, res.logNotes);
        res.status(400).type('application/json').json({ error: err.message });
      }
    }
  );

  router.post('/verifyRegistration',
    // csrfCheck,
    useragent.express(),
    express.json(),
    async (req, res) => {
      try {
        if (!req.session.regChallenge) {
          res.logNotes.add('session doesn\'t contain registration challenge');
          return res.status(401).json({ error: 'Reload this page — your session expired' });
        }

        await storeRouter.deleteAdminBlob(path.join(INVITE_DIR_NAME, req.query?.token + '.yaml'));

        const { verified, registrationInfo } = await verifyRegistrationResponse({
          response: req.body,
          expectedChallenge: req.session.regChallenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: false
        });

        if (!verified) {
          throw new Error('Verification failed.');
        }

        if (!req.session.user.credentials) { req.session.user.credentials = {}; }
        const name = nameFromUseragent(req.body.authenticatorAttachment, req.useragent, req.body.response?.transports);
        const credential = Object.assign({}, registrationInfo,
          { transports: req.body?.response?.transports, name, createdAt: new Date() });
        req.session.user.credentials[Buffer.from(registrationInfo.credentialID.buffer).toString('base64url')] = credential;
        await accountMgr.updateUser(req.session.user, res.logNotes);
        res.logNotes.add(`Passkey “${credential.name}” saved for “${req.session.user.username}”`);

        req.session.privileges = { ...req.session.user.privileges }; // includes admin privileges
        return res.status(201).json({ verified });
      } catch (err) {
        removeUserDataFromSession(req.session);
        errToMessages(err, res.logNotes);
        return res.status(400).json({ error: err.message });
      } finally {
        delete req.session.regChallenge;
      }
    });

  router.post('/cancelInvite',
    // csrfCheck,
    async (req, res) => {
      try {
        removeUserDataFromSession(req.session);
        await storeRouter.deleteAdminBlob(path.join(INVITE_DIR_NAME, req.query?.token + '.yaml'));
        res.json({});
      } catch (err) {
        errToMessages(err, res.logNotes);
        res.status(400).json({ error: 'Something went wrong' });
      }
    }
  );

  async function loadAdmin (req, res, next) {
    try {
      removeUserDataFromSession(req.session);
      const inviteFile = await storeRouter.readAdminBlob(path.join(INVITE_DIR_NAME, req.query?.token + '.yaml'));
      const userInvite = YAML.parse(inviteFile);
      const contactURL = new URL(userInvite.contactURL); // validates & normalizes
      req.contactURL = contactURL.href;
      if (!userInvite.expiresAt || !(Date.now() <= new Date(userInvite.expiresAt))) {
        await storeRouter.deleteAdminBlob(path.join(INVITE_DIR_NAME, req.query?.token + '.yaml'));
        throw new Error('invite expired');
      }

      let username = req.username = userInvite.username?.trim();
      if (username) {
        await storeRouter.upsertAdminBlob(path.join(CONTACT_URL_DIR, encodeURIComponent(contactURL.href) + '.yaml'), 'application/yaml', username);
      } else {
        try {
          username = await storeRouter.readAdminBlob(path.join(CONTACT_URL_DIR, encodeURIComponent(contactURL.href) + '.yaml'));
        } catch (err) {
          if (!['NoSuchBlobError', 'NoSuchKey'].includes(err.name)) {
            throw err;
          }
        }
      }
      username ||= req.session.user?.username;

      let user;
      if (username) {
        try {
          user = await accountMgr.getUser(username, res.logNotes);
          user.privileges ||= userInvite.privileges; // do we really need this backstop?
        } catch (err) {
          if (err.name !== 'NoSuchUserError') {
            throw err;
          }
        }
      }

      if (!user) {
        delete userInvite.expiresAt;
        user = { credentials: {}, ...userInvite, ...(username && { username }) };
        req.session.isUserSynthetic = true;
      }
      req.session.user = user;

      next();
    } catch (err) {
      removeUserDataFromSession(req.session);
      errToMessages(err, res.logNotes);
      res.status(401).render('login/error.html', {
        title: 'Your invitation has expired or is not valid',
        host: getHost(req),
        privileges: req.session.privileges || {},
        accountPrivileges: req.session.user?.privileges || {},
        subtitle: '(or there was an error)',
        message: 'Log in from your old device and invite yourself to create a new passkey.'
      });
    }
  }

  router.bootstrap = async function bootstrap () {
    await initProtocols(storeRouter);

    const bootstrapOwner = process.env.BOOTSTRAP_OWNER ? process.env.BOOTSTRAP_OWNER.trim() : '';
    let idx = bootstrapOwner.indexOf(' ');
    if (idx < 0) { idx = bootstrapOwner.length; }
    const contactStr = bootstrapOwner.slice(0, idx);
    if (!contactStr) { return; }
    try {
      const contactURL = calcContactURL(contactStr);
      const filePath = path.join(INVITE_DIR_NAME, `${encodeURIComponent(contactURL)}.uri`);
      try {
        await storeRouter.metadataAdminBlob(filePath);
        getLogger().info(`owner invite already created for ${contactURL}`);
        return;
      } catch (err) {
        if (!['NoSuchBlobError', 'NoSuchKey'].includes(err.name)) {
          throw err;
        }
      }
      const username = bootstrapOwner.slice(idx).trim();
      const [_, inviteURL] = await router.generateInviteURL(contactURL.href, username, {
        OWNER: true,
        ADMIN: true,
        STORE: true
      });
      await storeRouter.upsertAdminBlob(filePath, 'application/yaml', inviteURL.href + '\n');
      getLogger().notice(`wrote owner invite to “${filePath}”`); // must log during boot (no res obj)
      // inviteUser(contactStr, username, inviteURL)
    } catch (err) {
      getLogger().warning(Array.from(errToMessages(err, new Set([`while sending owner invite to “${contactStr}”`]))).join(' '));
    }
  };

  router.generateInviteURL = async function (contactStr, username, privileges = { STORE: true }) {
    username = username?.trim() || '';
    contactStr = contactStr?.trim();
    if (!contactStr) {
      throw new Error('contactStr can\'t be empty');
    }

    const contactURL = calcContactURL(contactStr);
    const token = crypto.randomBytes(256 / 8).toString('base64url');
    await storeRouter.upsertAdminBlob(path.join(INVITE_DIR_NAME, token + '.yaml'), 'application/yaml',
      YAML.stringify({ // createAccount will be called with these values (except expiresAt)
        username,
        contactURL,
        privileges,
        expiresAt: new Date(Date.now() + INVITE_DURATION)
      }));
    await storeRouter.deleteAdminBlob(path.join(INVITE_REQUEST_DIR, encodeURIComponent(contactURL.href) + '.yaml'));
    return [contactURL, new URL('/admin/acceptInvite?token=' + token, 'https://' + hostIdentity)];
  };

  // ----------------------- invite request list ----------------------------------------------

  router.get('/inviteRequests',
    hasAdminPrivilege,
    async (req, res, next) => {
      try {
        const items = (await storeRouter.listAdminBlobs(INVITE_REQUEST_DIR)).map(
          m => ({ contacturl: decodeURIComponent(m.path.slice(0, -5)), privilegeGrant: { STORE: true } })
        ).sort(
          (a, b) => a.contacturl.toLowerCase() - b.contacturl.toLowerCase()
        );

        res.logNotes.add(`${items.length} invite requests`);
        res.set('Cache-Control', 'private, no-cache');
        res.render('admin/invite-requests.html', {
          title: 'Requests for Invitation',
          host: getHost(req),
          privileges: req.session.privileges || {},
          accountPrivileges: req.session.user?.privileges || {},
          items,
          protocolOptions: protocolOptions(),
          privilegeGrant: { STORE: true },
          params: { submitName: 'Create User Invitation' },
          error: null
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post('/deleteInviteRequest',
    // csrfCheck,
    async (req, res) => {
      try {
        await storeRouter.deleteAdminBlob(path.join(INVITE_REQUEST_DIR, encodeURIComponent(req.body.contacturl) + '.yaml'));
        res.json({});
        res.logNotes.add(`deleted invite request for “${req.body.contacturl}”`);
      } catch (err) {
        errToMessages(err, res.logNotes);
        res.status(400).json({ error: err.message });
      }
    }
  );

  // ----------------------- admin lists ----------------------------------------------

  router.get('/admins',
    // csrfCheck,
    hasAdminPrivilege,
    async (req, res, next) => {
      try {
        const admins = (await accountMgr.listUsers(res.logNotes)).filter(u => u.privileges?.ADMIN);
        admins.sort((a, b) => a.username?.localeCompare(b.username));

        res.logNotes.add(`${admins.length} admins`);
        res.set('Cache-Control', 'private, no-cache');
        res.render('admin/users.html', {
          title: 'Admins',
          host: getHost(req),
          privileges: req.session.privileges || {},
          accountPrivileges: req.session.user?.privileges || {},
          users: admins,
          protocolOptions: protocolOptions(),
          privilegeGrant: { ADMIN: true, STORE: true },
          params: { submitName: req.session.privileges?.OWNER ? 'Create Admin Invitation' : 'Create User Invitation' },
          error: null
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get('/users',
    // csrfCheck,
    hasAdminPrivilege,
    async (req, res, next) => {
      try {
        const users = await accountMgr.listUsers(res.logNotes);
        users.sort((a, b) => a.username?.localeCompare(b.username));

        res.logNotes.add(`${users.length} users`);
        res.set('Cache-Control', 'private, no-cache');
        res.render('admin/users.html', {
          title: 'Users',
          host: getHost(req),
          privileges: req.session.privileges || {},
          accountPrivileges: req.session.user?.privileges || {},
          users,
          protocolOptions: protocolOptions(),
          privilegeGrant: { STORE: true },
          params: { submitName: 'Create User Invitation' },
          error: null
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post('/sendInvite',
    // csrfCheck,
    async (req, res, _next) => {
      try {
        if (!(req.session.privileges?.ADMIN || (req.session.user && req.body.contacturl === req.session.user?.contactURL))) {
          res.logNotes.add('session does not have ADMIN privilege');
          res.status(401).type('text/plain').send('Ask an admin to send the invite');
          return;
        }

        const privilegeGrant = JSON.parse(req.body.privilegegrant || '{}');
        if (privilegeGrant.OWNER) {
          privilegeGrant.ADMIN = true;
        }
        if (!req.session.privileges.OWNER) {
          delete privilegeGrant.OWNER;
          delete privilegeGrant.ADMIN;
        }
        const contactURL = req.body.contacturl || assembleContactURL(req.body.protocol, req.body.address).href;
        res.logNotes.add(`inviting ${contactURL} w/ privileges ${Object.keys(privilegeGrant).join(', ')}`);
        const [_, inviteURL] = await router.generateInviteURL(contactURL, req.body.username, privilegeGrant);
        let title, text;
        if (privilegeGrant.ADMIN) {
          title = `${hostIdentity} Admin Invite`;
          text = req.body.username
            ? `${req.body.username}, to create a passkey for ${hostIdentity} for a new device or browser, copy and paste this URL into the browser on that device:`
            : `You're invited to be an admin on ${hostIdentity}, a remoteStorage server! To accept, copy and paste this URL into your browser:`;
        } else {
          title = `${hostIdentity} User Invite`;
          text = req.body.username
            ? `${req.body.username}, to create a passkey for ${hostIdentity} for a new device or browser, copy and paste this URL into the browser on that device:`
            : `You're invited to use remoteStorage to store data on ${hostIdentity}! To accept, copy and paste this URL into your browser:`;
        }
        res.status(201).json({ url: inviteURL, title, text, contactURL });
      } catch (err) {
        errToMessages(err, res.logNotes);
        res.status(400).type('text/plain').send(err.message);
      }
    }
  );

  // ----------------------- util ----------------------------------------------

  function hasAdminPrivilege (req, res, next) {
    if (req.session.privileges?.ADMIN) {
      next();
    } else {
      res.logNotes.add('session does not have ADMIN privilege');
      if (['GET', 'HEAD'].includes(req.method)) {
        res.redirect(307, './login');
      } else {
        res.logNotes.add('session lacks ADMIN privilege');
        res.status(401).end();
      }
    }
  }

  /** Should be called whenever there's an error relating to user credentials */
  return router;
};
