const crypto = require('crypto');

const ENCODING = 'utf-8';
const SYMMETRIC_ALGO = 'aes-256-cbc';
const IV = Buffer.from('0000000000000000');

/**
 * @param {(string<utf-8>|Buffer|TypedArray)} plainblob - to hash
 * @param {string<utf-8>} password
 * @returns {stringr} base64 of cypherblob Buffer
 */
function symmetricEncrypt (plainblob, password) {
  const padded = password.padEnd(32, '0');
  const cypher = crypto.createCipheriv(SYMMETRIC_ALGO, padded, IV);
  const buf = Buffer.concat([cypher.update(plainblob, ENCODING), cypher.final()]);
  return buf.toString('base64');
}

/**
 * @param {string} cypherblob64 - base64 encoded cypherblob Buffer
 * @param {(string<utf-8>|Buffer|TypedArray)} password - to hash with (optional)
 * @returns {Buffer} plainblob
 */
function symmetricDecrypt (cypherblob64, password) {
  const buf = Buffer.from(cypherblob64, 'base64');
  const padded = password.padEnd(32, '0');
  const cypher = crypto.createDecipheriv(SYMMETRIC_ALGO, padded, IV);
  return Buffer.concat([cypher.update(buf), cypher.final()]);
}

module.exports = { symmetricEncrypt, symmetricDecrypt };
