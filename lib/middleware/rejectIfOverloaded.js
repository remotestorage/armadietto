const { loadavg, cpus /*, freemem, totalmem */ } = require('os');
const errToMessages = require('../util/errToMessages');

const LOADAVG_REJECT = cpus().length * 1.02;
// const FREE_MEM_FRACT_REJECT = 0.1;

module.exports = function rejectIfOverloaded (req, res, next) {
  try {
    if (loadavg()[0] > LOADAVG_REJECT) {
      const excessLoad = (loadavg()[0] / cpus().length) - 1;
      const retryAfter = Math.max(Math.round(excessLoad * 120 + Math.random() * 4 - 2), 1);
      res.logNotes.add(`load average ${loadavg()[0]} / ${cpus().length} cores; retry-after ${retryAfter}s`);
      res.set({ 'Retry-After': retryAfter });
      return res.status(503).type('text/plain').send('server overloaded');
    }

    // const freeMemFract = freemem() / totalmem();
    // if (freeMemFract < FREE_MEM_FRACT_REJECT) {
    //   res.logNotes.add(`free memory ${freeMemFract}; retry-after ${OVERLOADED_RETRY_AFTER}s`);
    //   res.set({ 'Retry-After': OVERLOADED_RETRY_AFTER });
    //   return res.status(503).type('text/plain').send('server overloaded');
    // }
  } catch (err) {
    errToMessages(err, res.logNotes);
    // If there's a programming error, we can't actually know whether to reject requests, so this defaults to pass.
  }
  next();
};
