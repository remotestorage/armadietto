const express = require('express');
const path = require('path');
const { loggingMiddleware, getLogger } = require('./logger');
const indexRouter = require('./routes/index');
const requestInviteRouter = require('./routes/request-invite');
const webFingerRouter = require('./routes/webfinger');
const oAuthRouter = require('./routes/oauth');
const storageCommonRouter = require('./routes/storage_common');
const errorPage = require('./util/errorPage');
const helmet = require('helmet');
const shorten = require('./util/shorten');
const loginFactory = require('./routes/login');
const accountRouterFactory = require('./routes/account');
const adminFactory = require('./routes/admin');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);

module.exports = async function ({ hostIdentity, jwtSecret, accountMgr, storeRouter, basePath = '' }) {
  if (basePath && !basePath.startsWith('/')) { basePath = '/' + basePath; }

  const app = express();
  app.locals.basePath = basePath;

  // view engine setup
  app.engine('.html', require('ejs').__express);
  app.engine('.xml', require('ejs').__express);
  app.set('view engine', 'html');
  app.set('views', path.join(__dirname, 'views'));

  express.static.mime.define({ 'text/javascript': ['js'] });
  express.static.mime.define({ 'text/javascript': ['mjs'] });

  app.set('accountMgr', accountMgr);

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
        connectSrc: ['\'self\''],
        baseUri: ['\'self\''],
        frameAncestors: ['\'none\''],
        formAction: (process.env.NODE_ENV === 'production' ? ['https:'] : ['https:', 'http:']), // allows redirect to any RS app
        upgradeInsecureRequests: []
      }
    }
  }));
  app.use(express.urlencoded({ extended: true }));
  app.use(`${basePath}/assets`, express.static(path.join(__dirname, 'assets')));

  app.use(`${basePath}/signup`, requestInviteRouter(storeRouter));

  app.use([`${basePath}/.well-known`, `${basePath}/webfinger`], webFingerRouter);

  app.use(`${basePath}/storage`, storageCommonRouter(hostIdentity, jwtSecret));
  app.use(`${basePath}/storage`, storeRouter);

  // Only some routes require a session
  const memorySession = session({
    cookie: {
      path: `${basePath}/`,
      maxAge: 20 * 60 * 1000,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production'
    },
    store: new MemoryStore({ checkPeriod: 20 * 60 * 1000 }), // prune expired entries every 20 min
    rolling: false, // maxAge is absolute timeout
    resave: false,
    secret: jwtSecret,
    saveUninitialized: false,
    name: 'id'
  });
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1); // required for secure cookies
  }

  app.use([`${basePath}/`, `${basePath}/oauth`, `${basePath}/account`, `${basePath}/admin`], memorySession);

  app.use(`${basePath}/`, indexRouter);

  app.use(`${basePath}/oauth`, oAuthRouter(hostIdentity, jwtSecret, accountMgr));

  const loginUserRouter = await loginFactory(hostIdentity, jwtSecret, accountMgr, false);
  app.use(`${basePath}/account`, loginUserRouter);
  const accountRouter = await accountRouterFactory(hostIdentity, jwtSecret, accountMgr);
  app.use(`${basePath}/account`, accountRouter);

  const loginAdminRouter = await loginFactory(hostIdentity, jwtSecret, accountMgr, true);
  app.use(`${basePath}/admin`, loginAdminRouter);
  const admin = await adminFactory(hostIdentity, jwtSecret, accountMgr, storeRouter);
  app.use(`${basePath}/admin`, admin);

  // catches paths not handled and returns Not Found
  app.use(basePath, function (req, res) {
    const name = req.path.slice(1);
    errorPage(req, res, 404, { title: 'Not Found', message: `“${name}” doesn't exist` });
  });

  // redirect for paths outside the app
  app.use(function (req, res) {
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

  setTimeout(() => {
    admin.bootstrap().catch(getLogger().error);
  }, 0);

  return app;
};
