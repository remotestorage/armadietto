/** sanity check of username, to defend against ".." and whatnot */
const { rateLimiterBlock } = require('./rateLimiterMiddleware');
module.exports = async function sanityCheckUsername (req, res, next) {
  const username = req.params.username || req.data.username || '';
  if (username.length > 0 && !/\/|^\.+$/.test(username) && /[\p{L}\p{Nd}]{1,63}/u.test(username)) {
    return next();
  }

  res.logNotes.add('invalid user');
  res.status(400).end();
  await rateLimiterBlock(req.ip, 61);
};
