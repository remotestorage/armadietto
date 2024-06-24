const express = require('express');
const router = express.Router();
const { getHost } = require('../util/getHost');
const errToMessages = require('../util/errToMessages');
const errorPage = require('../util/errorPage');

const DISABLED_LOCALS = { title: 'Forbidden', message: 'Signing up is not allowed currently' };
const DISABLED_LOG_NOTE = 'signups disabled';

/* initial entry */
router.get('/', function (req, res) {
  if (req.app?.locals?.signup) {
    res.render('signup.html', {
      title: 'Signup',
      params: {},
      error: null,
      host: getHost(req)
    });
  } else {
    errorPage(req, res, 403, DISABLED_LOCALS, DISABLED_LOG_NOTE);
  }
});

/* submission or re-submission */
router.post('/',
  async function (req, res) {
    if (req.app?.locals?.signup) {
      try {
        const storageName = await req.app?.get('account').createUser(req.body, res.logNotes);
        res.logNotes.add(`created storage “${storageName}” for user “${req.body.username}”`);
        res.status(201).render('signup-success.html', {
          title: 'Signup Success',
          params: req.body,
          host: getHost(req)
        });
      } catch (err) {
        errToMessages(err, res.logNotes.add(`while creating user “${req.body?.username}”:`));
        const errChain = [err, ...(err.errors || []), ...(err.cause ? [err.cause] : []), new Error('indescribable error')];
        res.status(409).render('signup.html', {
          title: 'Signup Failure',
          params: req.body,
          error: errChain.find(e => e.message),
          host: getHost(req)
        });
      }
    } else {
      errorPage(req, res, 403, DISABLED_LOCALS, DISABLED_LOG_NOTE);
    }
  });

module.exports = router;
