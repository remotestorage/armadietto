const { getHost } = require('./getHost');

function errorPage (req, res, status = 500, messageOrLocals, logNote = '', logLevel = undefined) {
  res.status(status);

  const locals = {
    title: 'Something went wrong',
    status,
    params: {},
    host: getHost(req),
    ...(typeof messageOrLocals === 'string' ? { message: messageOrLocals } : messageOrLocals)
  };

  if (res.logNotes.size === 0 && (logNote || locals.error || locals.message)) {
    res.logNotes.add(logNote || locals.error || locals.message);
  }
  res.logLevel = logLevel;

  res.render('error.html', locals);
}

module.exports = errorPage;
