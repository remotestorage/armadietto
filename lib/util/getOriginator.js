module.exports = function getOriginator (req) {
  try {
    if (req.headers.origin) {
      return req.headers.origin;
    } else if (req.headers.referer) {
      return new URL(req.headers.referer).origin;
    } else if (req.body?.redirect_uri) {
      return new URL(req.body.redirect_uri).origin;
    } else if (req.query?.redirect_uri) {
      return new URL(req.query.redirect_uri).origin;
    } else if (req.query.client_id) {
      return new URL(req.query.client_id).origin;
    } else {
      return '-';
    }
  } catch (err) {
    return '???';
  }
};
