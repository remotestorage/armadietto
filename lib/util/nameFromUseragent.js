const parser = require('ua-parser-js');

module.exports = function nameFromUseragent (authenticatorAttachment = '', useragent = '', transports = []) {
  let ua, nameParts;
  switch (authenticatorAttachment) {
    case 'platform':
      ua = parser(useragent);
      nameParts = [...(ua?.device?.vendor ? [ua?.device?.vendor] : []),
        ...(ua?.device?.model ? [ua?.device?.model] : []),
        ...(ua?.os?.name ? [ua?.os?.name] : []),
        ...(ua?.browser?.name ? [ua?.browser?.name] : [])];
      return nameParts.length > 0 ? nameParts.join(' ') : new Date().toLocaleString();
    case 'cross-platform':
      return `security key (${transports.join(', ')})`;
    default:
      return 'unknown';
  }
};
