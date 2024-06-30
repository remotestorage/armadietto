const ParameterError = require('./ParameterError');

module.exports = function calcContactURL (contactStr) {
  contactStr = contactStr?.trim();

  let contactURL;
  try {
    contactURL = new URL(contactStr);
  } catch (err) {
    if (/[\p{L}\p{N}]@(?:[A-Z0-9-]+\.)+[A-Z]{2,6}\b/iu.test(contactStr)) {
      contactURL = new URL('mailto:' + contactStr);
    } else {
      throw new Error(`“${contactStr}” is neither a URL nor email address`);
    }
  }

  if (!['sgnl:', 'mailto:', 'sms:', 'mms:', 'skype:', 'facetime:', 'xmpp:', 'msnim:', 'whatsapp:', 'tg:', 'ymsgr:', 'ssh:'].includes(contactURL.protocol)) {
    throw new ParameterError(`Not possible to contact user via “${contactURL.href}”`);
  }
  if (!['sgnl:', 'skype:', 'msnim:', 'whatsapp:', 'tg:', 'ymsgr:'].includes(contactURL.protocol)) {
    contactURL.search = '';
  }
  contactURL.hash = '';

  return contactURL;
};
