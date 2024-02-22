const getHost = require('./getHost');
const { logRequest } = require('../logger');

function errorPage (req, res, status = 500, messageOrLocals, logNote = '', logLevel = undefined) {
  res.status(status);

  const locals = {
    title: 'Error',
    status,
    params: {},
    error: null,
    host: getHost(req),
    ...(typeof messageOrLocals === 'string' ? { message: messageOrLocals } : messageOrLocals)
  };

  res.render('error.html', locals);

  const username = locals.username || (locals.params?.username) || '-';
  logRequest(req, username, status, 'n/a', logNote || locals.error || locals.message, logLevel);
}

module.exports = errorPage;
