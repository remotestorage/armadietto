/** Sets req.data to form data if form-urlencoded, otherwise to query parameters */
module.exports = function (req, res, next) {
  if (req.is('application/x-www-form-urlencoded')) {
    req.data = req.body;
  } else {
    req.data = req.query;
  }
  next();
};
