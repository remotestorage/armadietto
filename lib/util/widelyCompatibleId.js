const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789' + LETTERS;

/**
 * Generates a random identifier starting with a letter and using only lowercase letters and digits.
 * @param { number } numBits desired number of bits of randomness
 * @returns { string }
 */
module.exports = function widelyCompatibleId (numBits) {
  const len = Math.ceil(numBits / Math.log2(36));
  let s = LETTERS[Math.floor(Math.random() * 26)]; // This reduces the number of random bits slightly.
  while (s.length < len) {
    s += DIGITS[Math.floor(Math.random() * 36)];
  }
  return s;
};
