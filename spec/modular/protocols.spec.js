/* eslint-env mocha, chai, node */
/* eslint no-unused-vars: ["warn", { "varsIgnorePattern": "^_", "argsIgnorePattern": "^_" }]  */
/* eslint-disable no-unused-expressions */

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));
const { assembleContactURL, calcContactURL } = require('../../lib/util/protocols');
const ParameterError = require('../../lib/util/ParameterError');

describe('calcContactURL', function () {
  it('should strip query but not strip hash from Signal URL', function () {
    expect(calcContactURL('sgnl://signal.me/?foo=bar#p/+18005551212').href)
      .to.equal('sgnl://signal.me/#p/+18005551212');
  });
  it('should strip hash but not query param "id" from Threema: URL', function () {
    expect(calcContactURL('threema://compose?id=ABCDEFGH&text=Test%20Text#anotherHash').href)
      .to.equal('threema://compose?id=ABCDEFGH');
  });
  it('should strip query and hash from FaceTime: URL', function () {
    expect(calcContactURL('facetime:denise@place.us?subject=Something%20random#someHash').href)
      .to.equal('facetime:denise@place.us');
    expect(calcContactURL('facetime:14085551234?subject=Something%20random#someHash').href)
      .to.equal('facetime:14085551234');
  });
  it('should strip query and hash from Jabber URL', function () {
    expect(calcContactURL('xmpp:username@domain.tld?subject=Something%20random#someHash').href)
      .to.equal('xmpp:username@domain.tld');
  });
  it('should strip hash but not query param "chat" from Skype: URL', function () {
    expect(calcContactURL('skype:username@domain.tld?add&topic=foo').href)
      .to.equal('skype:username@domain.tld?chat');
    expect(calcContactURL('skype:+18885551212?topic=foo&chat').href)
      .to.equal('skype:+18885551212?chat');
  });
  it('should strip query and hash from e-mail URL', function () {
    expect(calcContactURL('mailto:denise@place.us?subject=Something%20random#someHash').href)
      .to.equal('mailto:denise@place.us');
  });
  it('should change MMS URL to SMS and strip query and hash', function () {
    expect(calcContactURL('mms:+15153755550?body=Hi%20there#someHash').href)
      .to.equal('sms:+15153755550');
  });
  it('should strip hash but not query param "phone" from Whatsapp URL', function () {
    expect(calcContactURL('whatsapp://send/?foo=bar&phone=447700900123#yetAnotherHash').href)
      .to.equal('whatsapp://send/?phone=447700900123');
  });
  it('should strip hash but not query param "phone" or username from Telegram URL', function () {
    expect(calcContactURL('tg://resolve?foo=bar&phone=19995551212#andAnotherHash').href)
      .to.equal('tg://resolve?phone=19995551212');
    expect(calcContactURL('tg://resolve?foo=bar&domain=bobroberts#andAnotherHash').href)
      .to.equal('tg://resolve?domain=bobroberts');
  });
});

describe('assembleContactURL', function () {
  it('should throw error when protocol missing', function () {
    expect(() => assembleContactURL(undefined, '8885551212')).to.throw(ParameterError, /not supported/);
  });
  it('should throw error when address missing', function () {
    expect(() => assembleContactURL('sgnl:', undefined)).to.throw(ParameterError, /Missing address/);
  });
  for (const protocol of [
    ['sgnl:', '(800) 555-1212', 'sgnl://signal.me/#p/+18005551212'],
    ['threema:', 'ABCDEFGH', 'threema://compose?id=ABCDEFGH'],
    ['facetime:', '+1 408 555-1234', 'facetime:+14085551234'],
    ['facetime:', 'user@example.com', 'facetime:user@example.com'],
    ['xmpp:', 'username@domain.tld', 'xmpp:username@domain.tld'],
    ['skype:', 'username', 'skype:username?chat'],
    ['skype:', '+1-888-999-7777', 'skype:+18889997777?chat'],
    ['mailto:', 'me@myschool.edu', 'mailto:me@myschool.edu'],
    ['sms:', '(888) 555 6666', 'sms:+18885556666'],
    ['mms:', '(800) 555 6666', 'sms:+18005556666'],
    ['whatsapp:', '+44 7700 900123', 'whatsapp://send/?phone=+447700900123'],
    ['tg:', '1 (999) 555-1212', 'tg://resolve?phone=19995551212'],
    ['tg:', 'bobroberts', 'tg://resolve?domain=bobroberts']
  ]) {
    it(`should assemble ${protocol[0]} URL`, function () {
      expect(assembleContactURL(protocol[0], protocol[1]).href).to.equal(protocol[2]);
    });
  }
});
