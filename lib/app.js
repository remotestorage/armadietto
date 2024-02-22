const createError = require('http-errors');
const express = require('express');
const path = require('path');
const logger = require('morgan');
const indexRouter = require('./routes/index');
const getHost = require('./util/getHost');
const helmet = require('helmet');

const app = express();

// view engine setup
app.engine('.html', require('ejs').__express);
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
// app.use(express.json());
// app.use(express.urlencoded({ extended: false }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.use('/', indexRouter);

// catches 404 and forwards to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, _next) {
  // sets locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // renders the error page
  res.status(err.status || 500);
  res.render('error.html', { title: 'Error', status: err.status || 500, host: getHost(req) });
});

module.exports = app;
