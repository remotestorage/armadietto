const express = require('express');
const router = express.Router();
const { corsAllowPrivate } = require('../util/corsMiddleware');
const cors = require('cors');
const { getHostBaseUrl } = require('../util/getHost');
const OAUTH_VERSION = 'http://tools.ietf.org/html/rfc6749#section-4.2';
const PROTOCOL_VERSION = 'draft-dejong-remotestorage-22';

// /.well-known
router.options(['/webfinger', '/host-meta(.json)?'], corsAllowPrivate, cors());

router.get(['/webfinger', '/host-meta(.json)?'], corsAllowPrivate, cors(), wellKnown);

function wellKnown (req, res) {
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
        type: PROTOCOL_VERSION,
        properties: {
          'auth-method': OAUTH_VERSION,
          'auth-endpoint': hostBaseUrl + '/oauth/' + user,
          'http://remotestorage.io/spec/version': PROTOCOL_VERSION,
          'http://tools.ietf.org/html/rfc6750#section-2.3': true
        }
      }]
    };
    content.links[0].properties[OAUTH_VERSION] = content.links[0].properties['auth-endpoint'];

    if (useJSON) {
      res.type('application/json').json(content);
    } else {
      res.type('application/xrd+xml').render('resource.xml', content);
    }
  }
}

// /webfinger
router.get(['/jrd', '/xrd'], corsAllowPrivate, cors(), webfinger);

function webfinger (req, res) {
  const resource = req.query.resource;
  const user = resource?.replace(/^acct:/, '').split('@')?.[0];
  const hostBaseUrl = getHostBaseUrl(req);

  const content = {
    links: [{
      rel: 'remoteStorage',
      api: 'simple',
      auth: hostBaseUrl + '/oauth/' + user,
      template: hostBaseUrl + '/storage/' + user + '/{category}'
    }]
  };

  if (req.path.startsWith('/xrd')) {
    res.type('application/xrd+xml').render('account.xml', content);
  } else {
    res.type('application/jrd+json').json(content);
  }
}

module.exports = router;
