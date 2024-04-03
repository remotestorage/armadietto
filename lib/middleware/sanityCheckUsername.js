/** sanity check of username, to defend against ".." and whatnot */
module.exports = function sanityCheckUsername (req, res, next) {
  const username = req.params.username || req.data.username || '';
  if (username.length > 0 && !/\/|^\.+$/.test(username) && /[\p{Lu}\p{Ll}\p{Lt}\p{Lo}\p{Nd}]{1,63}/u.test(username)) {
    return next();
  }

  res.logNotes.add('invalid user');
  res.status(400).end();
};
