const express = require('express');
const router = express.Router();
const { getHostBaseUrl } = require('../util/getHost');

router.get('/jrd', handler);
router.get('/xrd', handler);

function handler (req, res) {
  const resource = req.query.resource;
  const user = resource.replace(/^acct:/, '').split('@')?.[0];
  const hostBaseUrl = getHostBaseUrl(req);

  const content = {
    links: [{
      rel: 'remoteStorage',
      api: 'simple',
      auth: hostBaseUrl + '/oauth/' + user,
      template: hostBaseUrl + '/storage/' + user + '/{category}'
    }]
  };

  res.set('Access-Control-Allow-Origin', '*');
  if (req.path.startsWith('/xrd')) {
    res.type('application/xrd+xml').render('account.xml', content);
  } else {
    res.type('application/jrd+json').json(content);
  }
}

module.exports = router;
