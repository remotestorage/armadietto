/* eslint-env node */

module.exports = function replaceUint8 (key, value) {
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer).toString('base64url');
  } else {
    return value;
  }
};
