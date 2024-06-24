module.exports = function isSecureRequest (req) {
  return req.secure ||
    req.get('x-forwarded-ssl') === 'on' ||
    req.get('x-forwarded-scheme') === 'https' ||
    req.get('x-forwarded-proto') === 'https';
};
