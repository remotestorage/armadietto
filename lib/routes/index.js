const express = require('express');
const router = express.Router();
const { getHost } = require('../util/getHost');

/* GET home page. */
router.get('/', function (req, res) {
  res.render('index2.html', {
    title: 'Welcome',
    host: getHost(req),
    privileges: req.session.privileges || {},
    accountPrivileges: req.session.user?.privileges || {}
  });
});

module.exports = router;
