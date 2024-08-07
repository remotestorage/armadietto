const winston = require('winston');
const { format } = winston;
const { printf } = format;
const path = require('path');
const getOriginator = require('./util/getOriginator');
const shorten = require('./util/shorten');

const LOG_NOTE_MAX_LEN = 150;

let logger;

function configureLogger (options) {
  const defaults = {
    log_dir: '',
    stdout: [],
    log_files: []
  };
  options = Object.assign(defaults, options);

  // provided log_dir should be an absolute path where logs
  // will reside. Otherwise it just logs them to the root dir
  // of your app
  const loggerPath = options.log_dir || '';

  let fileTransports = [];
  if (options.log_files) {
    fileTransports = options.log_files.map(level => {
      // if we pass "combined", it's a special strategy that just
      // logs everything to a single file
      const settings = {
        filename: path.join(loggerPath, `${level}.log`)
      };

      if (level !== 'combined') {
        settings.level = level;
      }

      return new winston.transports.File(settings);
    });
  }

  // journald will supply the date
  const minimalFormat = printf(({ level, message }) => {
    return `${level}: ${message}`;
  });

  let consoleTransports = [];
  if (options.stdout) {
    consoleTransports = options.stdout.map(level => {
      // if we pass "combined", it's a special strategy that just
      // logs everything to a single file
      const settings = {};

      if (level !== 'combined') {
        settings.level = level;
      }
      if (!settings.format) {
        settings.format = minimalFormat;
      }

      return new winston.transports.Console(settings);
    });
  }

  if (fileTransports.length === 0 && consoleTransports.length === 0) {
    consoleTransports.push(new winston.transports.Console({
      level: 'notice',
      format: minimalFormat
    }));
  }

  const transports = [...fileTransports, ...consoleTransports];

  logger = winston.createLogger({
    levels: winston.config.syslog.levels,
    level: 'debug',
    format: winston.format.combine(
      // we want to be able to pass an error object to the logger
      // and have it include a mini stack trace
      winston.format.errors({ stack: true }),
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports,
    exceptionHandlers: transports,
    rejectionHandlers: transports
  });

  return logger;
}

function getLogger () {
  return logger;
}

function loggingMiddleware (req, res, next) {
  res.logNotes = new Set();
  res.on('finish', () => {
    let names = new Set([req.body?.username, req.query?.username, req.params?.username, req.username, req.session?.oauthParams?.username, req.session?.user?.username].filter(n => Boolean(n)));
    if (names.size === 0) {
      names = new Set([req.contactURL, req.session?.user?.contactURL].filter(n => Boolean(n)));
    }
    const username = names.size > 0 ? Array.from(names).join('|') : '-';
    logRequest(req, username, res.statusCode,
      res._contentLength ?? res.get('Content-Length') ?? '-', shorten(Array.from(res.logNotes).join(' '), LOG_NOTE_MAX_LEN), res.logLevel);
  });
  next();
}

function logRequest (req, username, status, numBytesWritten, logNote, logLevel) {
  let level;
  if (logLevel) {
    level = logLevel;
  } else if ([502, 504, 507].includes(status)) { // Bad Gateway, Gateway Timeout, Insufficient Storage
    level = 'error'; // problem with backing store
  } else if (status === 503) { // Service Unavailable
    level = 'warning';
  } else if (!status || status >= 500) { // presumably a coding error
    level = 'crit';
  } else if ([401, 201].includes(status)) { // user authentication & blob creation are notable
    level = 'notice';
  } else if (req.originalUrl === '/favicon.ico') { // browsers request this too often
    level = 'debug';
  } else if (status >= 400) { // client error
    level = 'warning';
  } else if ([301, 302, 307, 308].includes(status)) { // redirects are boring
    level = 'debug';
  } else {
    level = 'info'; // OK and Not Modified are routine
  }

  const clientAddress = req.headers['x-forwarded-for'] || req.socket.address().address;

  const appHost = getOriginator(req);

  let url = req.originalUrl ?? req.url;
  if (url.length > 100) {
    url = url.slice(0, 99) + '…';
  }
  let line = `${clientAddress} ${appHost} ${username} ${req.method} ${url} ${status} ${numBytesWritten}`;
  if (logNote) {
    if (logNote instanceof Error) {
      logNote = logNote.message || logNote.code || logNote.name || logNote.toString();
    }
    line += ' «' + logNote + '»';
  }
  logger.log(level, line);
}

module.exports = { configureLogger, getLogger, loggingMiddleware, logRequest };
