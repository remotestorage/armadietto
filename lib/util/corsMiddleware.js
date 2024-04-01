const cors = require('cors');

module.exports = {
  corsAllowPrivate: function corsAllowPrivate (req, res, next) {
    res.set('Access-Control-Allow-Private-Network', 'true');
    next();
  },
  corsRS: cors({ origin: true, allowedHeaders: 'Content-Type, Authorization, Content-Length, If-Match, If-None-Match, Origin, X-Requested-With', methods: 'GET, HEAD, PUT, DELETE', exposedHeaders: 'ETag', maxAge: 7200 })
};
