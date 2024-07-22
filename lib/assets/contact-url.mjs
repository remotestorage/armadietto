/* eslint-env browser es2022 */

const select = document.querySelector('select');
select.addEventListener('input', protocolChanged);
select.dispatchEvent(new InputEvent('input'));

function protocolChanged(evt) {
  let type, pattern, label, placeholder;
  switch (evt.target.value) {
    case 'sgnl:':
      type = 'tel';
      pattern = '\\+?[\\d \\)\\(\\*\\-]{4,24}';
      label = 'Phone number'
      placeholder = '+1 800 555 1212';
      break;
    case 'threema:': // threema://compose?text=Test%20Text
      type = 'text';
      pattern = '[a-zA-Z0-9]{8}';
      label = 'Threema ID';
      placeholder = 'ABCDEFGH';
      break;
    case 'facetime:':
      type = 'text';
      pattern = '.*[\\p{L}\\p{N}]+@[a-zA-Z0-9][a-zA-Z0-9.]{2,}[a-zA-Z0-9]|\\+?[\\d \\)\\(\\*\\-]{4,24}';
      label = 'Apple ID or phone number'
      placeholder = 'username@domain.tld or +1 800 555 1212'
      break;
    case 'xmpp:': // xmpp:username@domain.tld
      type = 'email';
      pattern = null;
      // pattern = '[\\p{L}\\p{N}]+@[a-zA-Z0-9][a-zA-Z0-9.]{2,}[a-zA-Z0-9]';
      label = "Jabber ID";
      placeholder = 'username@domain.tld'
      break;
    case 'skype:': // skype:<username|number>?[add|call|chat|sendfile|userinfo][&topic=foo]
      type = 'text';
      pattern = '(live:)?[\\w\\. @\\)\\(\\-]{3,24}';
      label = 'Skype ID';
      placeholder = 'email, phone number or username';
      break;
    case 'mailto:':
      type = 'email';
      pattern = null;
      // pattern = '.*[\\p{L}\\p{N}]+@[a-zA-Z0-9][a-zA-Z0-9.]{2,}[a-zA-Z0-9]';
      label = 'E-mail address';
      placeholder = 'username@domain.tld'
      break;
    case 'sms:':
    case 'mms:':
      type = 'tel';
      pattern = '\\+?[\\d \\)\\(\\*\\-]{4,24}';
      label = 'Phone number'
      placeholder = '+1 800 555 1212';
      break;
    case 'whatsapp:': // whatsapp://send/?phone=447700900123
      type = 'tel';
      pattern = '\\+?[\\d \\)\\(\\*\\-]{4,24}';
      label = 'Phone number'
      placeholder = '+1 800 555 1212';
      // TODO: support https://wa.me/15551234567
      break;
    case 'tg:': // tg://msg?to=+1555999
      type = 'tel';
      pattern = '\\+?[\\d \\)\\(\\*\\-]{4,24}';
      // pattern = '(@|https?://t.me/|https?://telegram.me/)?\w{3,24}';
      label = 'Phone number'
      placeholder = '+1 800 555 1212';
      break;
    default:
      type = 'text';
      pattern = '[\\p{L}\\p{N}]{2,}';
      label = 'Address'
      placeholder = 'At least two letters or digits';
  }
  const labelElmt = document.querySelector('[for=address]');
  labelElmt.innerText = label;
  const addressInpt = document.getElementById('address');
  addressInpt.setAttribute('type', type);
  if (pattern) {
    addressInpt.setAttribute('pattern', pattern);
  } else {
    addressInpt.removeAttribute('pattern');
  }
  addressInpt.setAttribute('placeholder', placeholder);
}
