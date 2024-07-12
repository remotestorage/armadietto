module.exports = function nameFromUseragent (authenticatorAttachment = '', useragent = {}, transports = []) {
  let nameParts;
  switch (authenticatorAttachment) {
    case 'platform':
      nameParts = [...(useragent?.platform ? [useragent?.platform] : []),
        ...(useragent?.browser ? [useragent?.browser] : [])];
      return nameParts.length > 0 ? nameParts.join(' ') : new Date().toLocaleString();
    case 'cross-platform':
      return `security key (${transports.join(', ')})`;
    default:
      return 'unknown';
  }
};
