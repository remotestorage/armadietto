const express = require('express');
const router = express.Router();
const { getHost } = require('../util/getHost');

/* GET home page. */
router.get('/', function (req, res) {
  res.render('index.html', {
    title: 'Welcome',
    host: getHost(req)
  });
});

module.exports = router;
