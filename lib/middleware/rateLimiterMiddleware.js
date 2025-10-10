// rateLimiterMiddleware.js — Armadietto remoteStorage server

// This is designed to defend against abusive requests from
// unauthorized clients. It is **not** designed to ensure
// fair sharing of resources between authorized users.
// The rate of requests from an authorized client is
// sanity-checked, but in general, one client may use **all**
// the capacity of all the instances. (Rate-limits are enforced
// per-instance.)

const { RateLimiterMemory, BurstyRateLimiter } = require('rate-limiter-flexible');

const POINTS_AUTH_REQUEST = 1;
const POINTS_UNAUTH_REQUEST = 50;
// OAuth page requires 9 GETs + 1 POST
// root page + login = 17 requests
const MAX_BURST_POINTS = 19 * POINTS_UNAUTH_REQUEST;
// requesting an invitation is 7 requests
const SUSTAINED_POINTS_PER_SEC = 8 * POINTS_UNAUTH_REQUEST;

// remotestorage.js appears to keep requesting until 10 failures

const rateLimiterSustained = new RateLimiterMemory({
  points: SUSTAINED_POINTS_PER_SEC,
  duration: 1
});

const rateLimiterBurst = new RateLimiterMemory({
  keyPrefix: 'burst',
  points: MAX_BURST_POINTS - SUSTAINED_POINTS_PER_SEC,
  duration: 10
});

/**
 * Authorized requests must use this to refund the points consumed by rateLimiterMiddleware
 * @param key IP address of the request
 * @param points typically POINTS_UNAUTH_REQUEST - POINTS_AUTH_REQUEST
 * @returns {Promise<void>}
 */
async function rateLimiterReward (key, points = 1) {
  await rateLimiterSustained.reward(key, points);
  await rateLimiterBurst.reward(key, points);
}

/**
 * Calling this is optional; it's used to slow down problematic requests even more.
 * @param key IP address of client
 * @param points often a multiple of POINTS_UNAUTH_REQUEST
 * @returns {Promise<void>}
 */
async function rateLimiterPenalty (key, points = 1) {
  await rateLimiterSustained.penalty(key, points);
  await rateLimiterBurst.penalty(key, points);
}

/**
 * Calling this is optional; it's used against clearly abusive clients.
 * @param key IP address of client
 * @param secDuration often 61 seconds
 * @returns {Promise<void>}
 */
async function rateLimiterBlock (key, secDuration) {
  await rateLimiterSustained.block(key, secDuration);
  await rateLimiterBurst.block(key, secDuration);
}

const rateLimiter = new BurstyRateLimiter(
  rateLimiterSustained,
  rateLimiterBurst
);

const rateLimiterMiddleware = async (req, res, next) => {
  try {
    // Presumes a request is unauthorized.
    // Authorized requests will get points back.
    await rateLimiter.consume(req.ip, POINTS_UNAUTH_REQUEST);
    next();
  } catch (err) {
    // await new Promise(resolve => loggingMiddleware(req, res, resolve));
    res.set({ 'Retry-After': Math.ceil(err.msBeforeNext / 1000) });
    res.status(429).end();
  }
};

module.exports = { POINTS_UNAUTH_REQUEST, POINTS_AUTH_REQUEST, rateLimiterReward, rateLimiterPenalty, rateLimiterBlock, rateLimiterMiddleware };
