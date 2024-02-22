const express = require('express');
const router = express.Router();
const getHost = require('../util/getHost');
const errorPage = require('../util/errorPage');
const { getLogger } = require('../logger');

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
        const store = req.app?.get('streaming store');
        const bucketName = await store.createUser(req.body);
        getLogger().notice(`created bucket “${bucketName}” for user “${req.body.username}”`);
        res.status(201).render('signup-success.html', {
          title: 'Signup Success',
          params: req.body,
          host: getHost(req)
        });
      } catch (err) {
        getLogger().error(`while creating user “${req.body?.username}”`, err);
        res.status(409).render('signup.html', {
          title: 'Signup Failure',
          params: req.body,
          error: err,
          host: getHost(req)
        });
      }
    } else {
      errorPage(req, res, 403, DISABLED_LOCALS, DISABLED_LOG_NOTE);
    }
  });

module.exports = router;
