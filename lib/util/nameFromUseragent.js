module.exports = function nameFromUseragent (useragent = {}) {
  const nameParts = [...(useragent?.platform ? [useragent?.platform] : []),
    ...(useragent?.browser ? [useragent?.browser] : [])];
  return nameParts.length > 0 ? nameParts.join(' ') : new Date().toLocaleString();
};
