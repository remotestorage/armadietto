const express = require('express');
const { assembleContactURL } = require('../../lib/util/protocols');
const { getHost } = require('../util/getHost');
const errToMessages = require('../util/errToMessages');
const errorPage = require('../util/errorPage');
const path = require('path');
const { protocolOptions } = require('../util/protocols');

const DISABLED_LOCALS = { title: 'Forbidden', message: 'Requesting invite is not allowed currently' };
const DISABLED_LOG_NOTE = 'requesting invites disabled';
const INVITE_REQUEST_DIR = 'inviteRequests';

module.exports = function (storeRouter) {
  const router = express.Router();

  /* initial entry */
  router.get('/', function (req, res) {
    try {
      if (req.app?.locals?.signup) {
        res.set('Cache-Control', 'public, max-age=1500');
        res.render('login/request-invite.html', {
          title: 'Request an Invitation',
          host: getHost(req),
          privileges: {},
          accountPrivileges: {},
          protocolOptions: protocolOptions(),
          params: { submitName: 'Request invite' },
          privilegeGrant: {},
          error: null
        });
      } else {
        errorPage(req, res, 403, DISABLED_LOCALS, DISABLED_LOG_NOTE);
      }
    } catch (err) {
      errToMessages(err, res.logNotes);
      res.status(401).render('login/error.html', {
        title: 'Error requesting invite',
        host: getHost(req),
        privileges: req.session.privileges || {},
        accountPrivileges: {},
        subtitle: '',
        message: 'There was an error displaying your info'
      });
    }
  });

  /* submission or re-submission */
  router.post('/',
    async function (req, res) {
      if (!req.app?.locals?.signup) {
        errorPage(req, res, 403, DISABLED_LOCALS, DISABLED_LOG_NOTE);
        return;
      }
      try {
        req.body.address = req.body.address.trim();

        const contactURL = req.contactURL = assembleContactURL(req.body.protocol, req.body.address).href;

        await storeRouter.upsertAdminBlob(path.join(INVITE_REQUEST_DIR, encodeURIComponent(contactURL) + '.yaml'), 'application/yaml', contactURL);

        res.status(201).render('login/request-invite-success.html', {
          title: 'Invitation Requested',
          host: getHost(req),
          privileges: {},
          accountPrivileges: {},
          params: { contactURL }
        });
      } catch (err) {
        errToMessages(err, res.logNotes.add(`while requesting invite “${req.body}”:`));

        const statusCode = err.name === 'ParameterError' ? 400 : 409;
        const errChain = [err, ...(err.errors || []), ...(err.cause ? [err.cause] : []), new Error(err.name || err.code || err.errno)];
        res.status(statusCode).render('login/request-invite.html', {
          title: 'Request Failure',
          host: getHost(req),
          privileges: {},
          accountPrivileges: {},
          protocolOptions: protocolOptions(),
          params: Object.assign(req.body, { submitName: 'Request invite' }),
          privilegeGrant: {},
          error: errChain.find(e => e.message)
        });
      }
    });

  return router;
};
