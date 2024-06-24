/**
 * Extracts & de-dupes payloads of error tree, for terse logging
 * @param {Error} err
 * @param {Set} messages
 * @returns {Set} the messages object, for chaining
 */
module.exports = function errToMessages (err, messages) {
  try {
    if (!(err instanceof Object)) { return messages; }

    if (err.name !== 'AggregateError') {
      if (err.name && !err.message?.includes(err.name) &&
        !Array.from(messages).some(msg => typeof msg === 'string' && msg?.includes(err.name))) {
        messages.add(err.name);
      }
      if (err.message) {
        messages.add(err.message);
      }
      if (err.code && !Array.from(messages).some(msg => typeof msg === 'string' && msg?.includes(err.code))) {
        messages.add(err.code);
      }
      const errno = err.errno ? String(err.errno) : '';
      if (errno && !Array.from(messages).some(msg => typeof msg === 'string' && msg?.includes(errno))) {
        messages.add(errno);
      }
      const statusCode = err.$metadata?.httpStatusCode ? String(err.$metadata.httpStatusCode) : '';
      if (statusCode) {
        messages.add(statusCode);
      }
      if (err.$metadata?.attempts > 1) {
        messages.add(`${err.$metadata.attempts} attempts`); // eslint-disable-line no-irregular-whitespace
      }
    }
    if (err.errors?.[Symbol.iterator]) {
      for (const e of err.errors) {
        errToMessages(e, messages);
      }
    }
    if (err.cause) {
      errToMessages(err.cause, messages);
    }
  } catch (err2) {
    messages.add(err2);
  }
  return messages;
};
