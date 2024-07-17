const { RateLimiterMemory, BurstyRateLimiter } = require('rate-limiter-flexible');

const SUSTAINED_REQ_PER_SEC = 8;
const MAX_BURST = 50; // remotestorage.js appears to keep requesting until 10 failures

const rateLimiterSustained = new RateLimiterMemory({
  points: SUSTAINED_REQ_PER_SEC,
  duration: 1
});

const rateLimiterBurst = new RateLimiterMemory({
  keyPrefix: 'burst',
  points: MAX_BURST - SUSTAINED_REQ_PER_SEC,
  duration: 10
});

async function rateLimiterPenalty (key, points = 1) {
  await rateLimiterSustained.penalty(key, points);
  await rateLimiterBurst.penalty(key, points);
}

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
    await rateLimiter.consume(req.ip);
    next();
  } catch (err) {
    res.set({ 'Retry-After': Math.ceil(err.msBeforeNext / 1000) });
    res.status(429).end();
  }
};

module.exports = { rateLimiterPenalty, rateLimiterBlock, rateLimiterMiddleware };
