const express = require('express');
const path = require('path');
const logger = require('morgan');
const indexRouter = require('./routes/index');
const signupRouter = require('./routes/signup');
const wellKnownRouter = require('./routes/well_known');
const webFingerRouter = require('./routes/webfinger');
const errorPage = require('./util/errorPage');
const helmet = require('helmet');
const shorten = require('./util/shorten');

let basePath = process.env.basePath || '';
if (basePath && !basePath.startsWith('/')) { basePath = '/' + basePath; }

const app = express();

// view engine setup
app.engine('.html', require('ejs').__express);
app.engine('.xml', require('ejs').__express);
app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'views'));

express.static.mime.define({ 'text/javascript': ['js'] });

app.use(logger('dev'));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      sandbox: ['allow-scripts', 'allow-forms', 'allow-popups', 'allow-same-origin'],
      defaultSrc: ['\'self\''],
      scriptSrc: ['\'self\''],
      scriptSrcAttr: ['\'none\''],
      styleSrc: ['\'self\''],
      imgSrc: ['\'self\''],
      fontSrc: ['\'self\''],
      objectSrc: ['\'none\''],
      childSrc: ['\'none\''],
      connectSrc: ['\'none\''],
      baseUri: ['\'self\''],
      frameAncestors: ['\'none\''],
      formAction: ['https:'], // allows redirect to any RS app
      upgradeInsecureRequests: []
    }
  }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(`${basePath}/assets`, express.static(path.join(__dirname, 'assets')));

app.use(`${basePath}/`, indexRouter);

app.use(`${basePath}/signup`, signupRouter);

app.use(`${basePath}/.well-known`, wellKnownRouter);
app.use(`${basePath}/webfinger`, webFingerRouter);

// catches 404 and forwards to error handler
app.use(basePath, function (req, res, next) {
  const name = req.path.slice(1);
  errorPage(req, res, 404, { title: 'Not Found', message: `“${name}” doesn't exist` });
});

// redirect for paths outside the app
app.use(function (req, res, next) {
  res.status(308).set('Location', basePath).end();
});

// error handler
app.use(function (err, req, res, _next) {
  errorPage(req, res, err.status || 500, {
    title: shorten(err.message, 30),
    message: err.message,
    error: req.app.get('env') === 'development' ? err : {}
  });
});

module.exports = app;
