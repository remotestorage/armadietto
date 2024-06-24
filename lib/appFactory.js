const express = require('express');
const path = require('path');
const { loggingMiddleware } = require('./logger');
const indexRouter = require('./routes/index');
const signupRouter = require('./routes/signup');
const webFingerRouter = require('./routes/webfinger');
const oAuthRouter = require('./routes/oauth');
const storageCommonRouter = require('./routes/storage_common');
const errorPage = require('./util/errorPage');
const helmet = require('helmet');
const shorten = require('./util/shorten');

module.exports = function ({ hostIdentity, jwtSecret, account, storeRouter, basePath = '' }) {
  if (basePath && !basePath.startsWith('/')) { basePath = '/' + basePath; }

  const app = express();
  app.locals.basePath = basePath;

  // view engine setup
  app.engine('.html', require('ejs').__express);
  app.engine('.xml', require('ejs').__express);
  app.set('view engine', 'html');
  app.set('views', path.join(__dirname, 'views'));

  express.static.mime.define({ 'text/javascript': ['js'] });

  app.set('account', account);

  app.use(loggingMiddleware);
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
        formAction: (process.env.NODE_ENV === 'production' ? ['https:'] : ['https:', 'http:']), // allows redirect to any RS app
        upgradeInsecureRequests: []
      }
    }
  }));
  app.use(express.urlencoded({ extended: true }));
  app.use(`${basePath}/assets`, express.static(path.join(__dirname, 'assets')));

  app.use(`${basePath}/`, indexRouter);

  app.use(`${basePath}/signup`, signupRouter);

  app.use([`${basePath}/.well-known`, `${basePath}/webfinger`], webFingerRouter);

  app.use(`${basePath}/oauth`, oAuthRouter(hostIdentity, jwtSecret));
  app.use(`${basePath}/storage`, storageCommonRouter(hostIdentity, jwtSecret));
  app.use(`${basePath}/storage`, storeRouter);

  // catches paths not handled and returns Not Found
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
    const message = err?.message || err?.errors?.find(e => e.message).message || err?.cause?.message || 'indescribable error';
    errorPage(req, res, err.status || 500, {
      title: shorten(message, 30),
      message,
      error: req.app.get('env') === 'development' ? err : {}
    });
  });

  return app;
};
