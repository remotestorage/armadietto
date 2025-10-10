const { loadavg, cpus /*, freemem, totalmem */ } = require('os');
const errToMessages = require('../util/errToMessages');

const LOADAVG_REJECT = cpus().length * 2.5;
// const FREE_MEM_FRACT_REJECT = 0.1;
const OVERLOADED_RETRY_AFTER = '3';

module.exports = function rejectIfOverloaded (req, res, next) {
  try {
    if (loadavg()[0] > LOADAVG_REJECT) {
      res.logNotes.add(`load average ${loadavg()[0]} / ${cpus().length} cores; retry-after ${OVERLOADED_RETRY_AFTER}s`);
      res.set({ 'Retry-After': OVERLOADED_RETRY_AFTER });
      return res.status(429).end();
    }

    // const freeMemFract = freemem() / totalmem();
    // if (freeMemFract < FREE_MEM_FRACT_REJECT) {
    //   res.logNotes.add(`free memory ${freeMemFract}; retry-after ${OVERLOADED_RETRY_AFTER}s`);
    //   res.set({ 'Retry-After': OVERLOADED_RETRY_AFTER });
    //   return res.status(429).end();
    // }
  } catch (err) {
    errToMessages(err, res.logNotes);
    // If there's a programming error, we can't actually know whether to reject requests, so this defaults to pass.
  }
  next();
};
