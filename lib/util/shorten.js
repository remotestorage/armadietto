function shorten (str, maxLength = 50) {
  if (typeof str !== 'string') {
    return '';
  }
  str = str.trim();
  if (str.length <= maxLength) {
    return str;
  } else {
    return str.slice(0, maxLength - 1) + '…';
  }
}

module.exports = shorten;
