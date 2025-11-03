const express = require('express');
const path = require('path');
const { loggingMiddleware, getLogger } = require('./logger');
const rejectIfOverloaded = require('./middleware/rejectIfOverloaded');
const indexRouter = require('./routes/index');
const robots = require('robots.txt');
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
const {
  POINTS_UNAUTH_REQUEST, POINTS_AUTH_REQUEST, rateLimiterPenalty, rateLimiterBlock, rateLimiterMiddleware,
  rateLimiterReward
} = require('./middleware/rateLimiterMiddleware');
const errToMessages = require('./util/errToMessages');

module.exports = async function ({ hostIdentity, jwtSecret, accountMgr, storeRouter, basePath = '' }) {
  if (basePath && !basePath.startsWith('/')) { basePath = '/' + basePath; }

  const app = express();
  app.locals.basePath = basePath;
  app.disable('x-powered-by');

  // view engine setup
  app.engine('.html', require('ejs').__express);
  app.engine('.xml', require('ejs').__express);
  app.set('view engine', 'html');
  app.set('views', path.join(__dirname, 'views'));

  express.static.mime.define({ 'text/javascript': ['js'] });
  express.static.mime.define({ 'text/javascript': ['mjs'] });

  app.set('accountMgr', accountMgr);

  if (process.env.NODE_ENV === 'production') {
    app.use(rateLimiterMiddleware);
    getLogger().info('rateLimiterMiddleware enabled');
  }

  // web browsers ask for this way too often, so doesn't log this
  app.get(['/favicon.ico', '/apple-touch-icon*'], (req, res, _next) => {
    res.set('Cache-Control', 'public, max-age=31536000');
    res.status(404).end();
  });

  app.use(loggingMiddleware);

  app.use(rejectIfOverloaded);

  app.use(robots(path.join(__dirname, 'robots.txt')));

  const helmetStorage = helmet({
    contentSecurityPolicy: {
      directives: {
        sandbox: ['allow-orientation-lock'],
        defaultSrc: ['\'none\''],
        scriptSrc: ['\'none\''],
        scriptSrcAttr: ['\'none\''],
        styleSrc: ['\'self\''],
        imgSrc: ['\'self\''],
        fontSrc: ['\'self\''],
        // styleSrc: ['\'self\'', req  => getOriginator(req)],
        // imgSrc: ['\'self\'', req  => getOriginator(req)],
        // fontSrc: ['\'self\'', req  => getOriginator(req)],
        objectSrc: ['\'none\''],
        childSrc: ['\'none\''],
        connectSrc: ['\'none\''],
        baseUri: ['\'self\''],
        frameAncestors: ['\'none\''],
        formAction: '\'none\'',
        upgradeInsecureRequests: []
      }
    },
    crossOriginResourcePolicy: false
  });
  const helmetWebapp = helmet({
    contentSecurityPolicy: {
      directives: {
        sandbox: ['allow-scripts', 'allow-forms', 'allow-popups', 'allow-same-origin', 'allow-orientation-lock'],
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
  });
  app.use((req, res, next) => {
    if (/^\/storage\//.test(req.url)) {
      helmetStorage(req, res, next);
    } else {
      helmetWebapp(req, res, next);
    }
  });

  app.use(express.urlencoded({ extended: true }));
  app.use(`${basePath}/assets`, express.static(path.join(__dirname, 'assets'), {
    fallthrough: true, index: false, maxAge: '25m'
  }));
  app.use(`${basePath}/assets`, async (req, res, _next) => {
    res.set('Cache-Control', 'public, max-age=1500');
    res.status(404).end();
  });

  app.use(`${basePath}/signup`, requestInviteRouter(storeRouter));

  app.use([`${basePath}/.well-known`, `${basePath}/webfinger`], webFingerRouter);

  app.use(`${basePath}/storage`, storageCommonRouter(hostIdentity, jwtSecret));
  app.use(`${basePath}/storage`, storeRouter);

  // Only some routes require a session.
  // A load balancer must apply sticky sessions for the 'id' cookie
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

  app.use([`${basePath}/`, `${basePath}/oauth`, `${basePath}/account`, `${basePath}/admin`], memorySession);

  app.use((req, _res, next) => {
    if (req.session?.privileges?.STORE) {
      // refunds the points consumed by rate-limiting middleware
      rateLimiterReward(req.ip, POINTS_UNAUTH_REQUEST - POINTS_AUTH_REQUEST);
    }
    next();
  });

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
  app.use(basePath, async function (req, res) {
    if (!res.get('Cache-Control')) {
      res.set('Cache-Control', 'max-age=1500');
    }
    const subpath = req.path.slice(basePath.length).split('/')?.[1];
    const name = req.path.slice(1);
    if (['.well-known', 'account', 'admin', 'crossdomain.xml', 'sitemap.xml'].includes(subpath) && ['GET', 'HEAD'].includes(req.method)) {
      res.logNotes.add('suspicious request; applying rate penalty');
      await rateLimiterPenalty(req.ip, 2 * POINTS_UNAUTH_REQUEST);
      errorPage(req, res, 404, { title: 'Not Found', message: `“${name}” doesn't exist` });
    } else { // probably hostile
      if (Object.keys(req.session?.privileges || {}).length > 0) {
        res.logNotes.add('suspicious request; applying rate penalty');
        await rateLimiterPenalty(req.ip, 2 * POINTS_UNAUTH_REQUEST);
      } else {
        res.logNotes.add('suspicious request; blocking');
        await rateLimiterBlock(req.ip, 61);
      }
      res.status(404).end();
    }
  });

  // redirect for paths outside the app
  app.use(async function (req, res) {
    await rateLimiterPenalty(req.ip, POINTS_UNAUTH_REQUEST);
    res.status(308).set('Location', basePath).end();
  });

  // error handler
  app.use(async function (err, req, res, _next) {
    const messages = new Set();
    errToMessages(err, messages);
    const messageStr = process.env.NODE_ENV !== 'production' ? Array.from(messages).join(' ') : 'An error occurred';

    const msgId = Math.floor(Math.random() * 1_000_000_000);
    for (const msg of messages.values()) {
      res.logNotes.add(msg);
    }
    res.logNotes.add(`msgId=${msgId}`);

    await rateLimiterPenalty(req.ip, POINTS_UNAUTH_REQUEST);
    errorPage(req, res, err.statusCode || 500, {
      title: shorten(messageStr, 30),
      message: messageStr + ` msgId=${msgId}`,
      error: null
    });
  });

  setTimeout(() => {
    admin.bootstrap().catch(getLogger().error);
  }, 0);

  return app;
};
