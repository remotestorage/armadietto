const express = require('express');
const router = express.Router();
const cors = require('cors');
const { getHostBaseUrl } = require('../util/getHost');
const WebFinger = require('../controllers/web_finger');

router.get('/webfinger', cors(), handler);
router.get('/host-meta(.json)?', cors(), handler);

function handler (req, res) {
  const resource = req.query.resource;
  const hostBaseUrl = getHostBaseUrl(req);
  const jsonRequested = req.path.endsWith('.json');
  const useJRD = req.url.startsWith('/webfinger');
  const useJSON = useJRD || (req.url.startsWith('/host-meta') && jsonRequested);

  let content;
  if (!resource) {
    content = {
      links: [{
        rel: 'lrdd',
        template: hostBaseUrl + '/webfinger/' + (useJSON ? 'jrd' : 'xrd') + '?resource={uri}'
      }]
    };
    if (useJSON) {
      res.type(useJRD ? 'application/jrd+json' : 'application/json').json(content);
    } else {
      res.type('application/xrd+xml').render('host.xml', content);
    }
  } else {
    const user = resource.replace(/^acct:/, '').split('@')?.[0];

    content = {
      links: [{
        href: hostBaseUrl + '/storage/' + user,
        rel: 'remotestorage',
        type: WebFinger.PROTOCOL_VERSION,
        properties: {
          'auth-method': WebFinger.OAUTH_VERSION,
          'auth-endpoint': hostBaseUrl + '/oauth/' + user,
          'http://remotestorage.io/spec/version': WebFinger.PROTOCOL_VERSION,
          'http://tools.ietf.org/html/rfc6750#section-2.3': true
        }
      }]
    };
    content.links[0].properties[WebFinger.OAUTH_VERSION] = content.links[0].properties['auth-endpoint'];

    if (useJSON) {
      res.type('application/json').json(content);
    } else {
      res.type('application/xrd+xml').render('resource.xml', content);
    }
  }
}

module.exports = router;
