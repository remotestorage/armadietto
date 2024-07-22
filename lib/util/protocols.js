const { format } = require('node:util');
const ParameterError = require('./ParameterError');

const protocols = {
  'sgnl:': {
    name: 'Signal',
    contactTemplate: '%s//signal.me/#p/%s',
    contactHasHash: true
  },
  'threema:': {
    name: 'Threema',
    contactTemplate: '%s//compose?id=%s',
    contactAllowedSearchKeys: ['id']
  },
  'facetime:': {
    name: 'FaceTime',
    contactTemplate: '%s%s'
  },
  'xmpp:': {
    name: 'Jabber',
    contactTemplate: '%s%s'
  },
  'skype:': {
    name: 'Skype',
    contactTemplate: '%s%s?chat',
    contactRequiredSearchKeys: ['chat']
  },
  'mailto:': {
    name: 'e-mail',
    contactTemplate: '%s%s'
  },
  'sms:': {
    name: 'SMS',
    contactTemplate: '%s%s'
  },
  'mms:': {
    name: 'MMS',
    actualProtocol: 'sms:',
    contactTemplate: '%s%s'
  },
  'whatsapp:': {
    name: 'WhatsApp',
    contactTemplate: '%s//send/?phone=%s',
    contactAllowedSearchKeys: ['phone']
  },
  'tg:': {
    name: 'Telegram',
    contactTemplate: '%s//resolve?domain=%s',
    contactTemplatePhone: '%s//resolve?phone=%s',
    contactAllowedSearchKeys: ['phone', 'domain']
  }
};

async function initProtocols (storeRouter) {
  // TODO: load configured set of protocols
}

function assembleContactURL (protocol, address) {
  address = address?.trim();
  if (!address) {
    throw new ParameterError('Missing address');
  }

  const protocolAttr = protocols[protocol];
  if (!protocolAttr) {
    throw new ParameterError(`Protocol “${protocol}” not supported`);
  }
  let { actualProtocol, contactTemplate, contactTemplatePhone, addressIsNeverPhone } = protocolAttr;
  if (!contactTemplate) {
    throw new Error(`No contactTemplate for protocol “${protocol}”`);
  }
  if (actualProtocol) {
    protocol = actualProtocol;
  }

  if (/^\+?[\d\s)(*x-]{4,20}$/.test(address) && !addressIsNeverPhone) {
    address = normalizePhoneNumber(address);
    if (contactTemplatePhone) {
      contactTemplate = contactTemplatePhone;
    }
  }

  const str = format(contactTemplate, protocol, address);

  return new URL(str);
}

function normalizePhoneNumber (raw) {
  const number = (raw.split('x')[0]).replace(/\D/g, '');

  if (raw.startsWith('+')) {
    return '+' + number;
  } else {
    if (number.length === 10 && !['0', '1'].includes(number[0])) { // matches North American pattern
      return '+1' + number;
    } else {
      return number;
    }
  }
}

function calcContactURL (contactStr) {
  contactStr = contactStr?.trim();

  let contactURL;
  try {
    contactURL = new URL(contactStr);
  } catch (err) {
    if (/[\p{L}\p{N}]@(?:[A-Z0-9-]+\.)+[A-Z]{2,6}\b/iu.test(contactStr)) {
      contactURL = new URL('mailto:' + contactStr);
    } else {
      throw new ParameterError(`“${contactStr}” is neither a URL nor email address`);
    }
  }

  const protocolAttr = protocols[contactURL.protocol];
  if (!protocolAttr) {
    throw new ParameterError(`Protocol “${contactURL.protocol}” not supported`);
  }
  const { actualProtocol, contactHasHash, contactAllowedSearchKeys = [], contactRequiredSearchKeys = [] } = protocolAttr;

  if (actualProtocol) {
    contactURL.protocol = actualProtocol;
  }

  const newSearchParams = new URLSearchParams();
  for (const key of contactRequiredSearchKeys) {
    newSearchParams.set(key, contactURL.searchParams.get(key) || '');
  }
  for (const [key, value] of contactURL.searchParams.entries()) {
    if (contactAllowedSearchKeys.includes(key)) {
      newSearchParams.set(key, value);
    }
  }
  newSearchParams.sort();
  contactURL.search = Array.from(newSearchParams.entries()).map(
    ([key, value]) => value ? key + '=' + value : key)
    .join('&');

  if (!contactHasHash) {
    contactURL.hash = '';
  }

  return contactURL;
}

function protocolOptions () {
  return Object.entries(protocols).map(
    entry =>
      ({ protocol: entry[0], name: entry[1].name })
  );
}

module.exports = { initProtocols, assembleContactURL, calcContactURL, protocolOptions };
