const { getHost } = require('./getHost');

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

  if (logNote || locals.error || locals.message) {
    res.logNotes.add(logNote || locals.error || locals.message);
  }
  res.logLevel = logLevel;

  res.render('error.html', locals);
}

module.exports = errorPage;
