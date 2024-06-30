const ParameterError = require('./ParameterError');

module.exports = function assembleContactURL (protocol, address) {
  if (!['sgnl:', 'threema:', 'mailto:', 'sms:', 'mms:', 'skype:', 'facetime:', 'xmpp:', 'whatsapp:', 'tg:', 'ymsgr:', 'ssh:'].includes(protocol)) {
    throw new ParameterError('Invalid protocol');
  }
  address = address.trim();
  if (!address) {
    throw new ParameterError('Missing address');
  }
  let urlStr;
  switch (protocol) {
    case 'sgnl:':
      urlStr = protocol + '//signal.me/#p/' + normalizePhoneNumber(address);
      break;
    case 'threema:':
      urlStr = protocol + `//compose?id=${address}`;
      break;
    case 'facetime:': // email or phone number
      if (/^\+?[\d\s)(*x-]+$/.test(address)) {
        address = normalizePhoneNumber(address);
      }
      urlStr = protocol + address;
      break;
    case 'xmpp:':
      urlStr = protocol + address;
      break;
    case 'skype:': // username or number
      if (/^\+?[\d\s)(*x-]+$/.test(address)) {
        address = normalizePhoneNumber(address);
      }
      urlStr = protocol + address;
      break;
    case 'mailto:':
      urlStr = protocol + address;
      break;
    case 'sms:':
      urlStr = protocol + normalizePhoneNumber(address);
      break;
    case 'whatsapp:':
      urlStr = protocol + '//send/?phone=' + normalizePhoneNumber(address);
      break;
    case 'tg:':
      urlStr = protocol + 'https?://telegram.me/?' + normalizePhoneNumber(address);
      break;
    default:
      throw new ParameterError('protocol not supported');
  }
  return new URL(urlStr);
};

function normalizePhoneNumber (raw) {
  const number = raw.replace(/\D/g, '');

  if (raw.startsWith('+')) {
    return '+' + number;
  } else {
    if (number.length === 10 && !number.startsWith('1')) {
      return '+1' + number;
    } else {
      return number;
    }
  }
}
