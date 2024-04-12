/* eslint-env mocha, chai, node */
/* eslint no-unused-vars: ["warn", { "varsIgnorePattern": "^_", "argsIgnorePattern": "^_" }]  */
/* eslint-disable no-unused-expressions */

const chai = require('chai');
const expect = chai.expect;
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const { configureLogger } = require('../../lib/logger');
const adminFactory = require('../../lib/routes/admin');
const process = require('process');
const path = require('path');
const YAML = require('yaml');
const express = require('express');
const session = require('express-session');

const INVITE_REQUEST_DIR = 'inviteRequests';
const ADMIN_INVITE_DIR_NAME = 'adminInvites';
const CONTACT_URL_DIR = 'contactUrls';
const HOST_IDENTITY = 'psteniusubi.github.io';
const { mockAccountFactory, CREDENTIAL_PRESENTED_RIGHT, CREDENTIAL_PRESENTED_WRONG, USER } = require('../util/mockAccount');
const crypto = require('crypto');
const loginFactory = require('../../lib/routes/login');
const NoSuchBlobError = require('../../lib/util/NoSuchBlobError');
const requestInviteRouter = require('../../lib/routes/request-invite');
const LOGIN_CHALLENGE = 'mJXERSBetL-NRL7AMozeWfnobXk';

const mockStoreRouter = {
  blobs: {},
  contentTypes: {},

  upsertAdminBlob: async function (path, contentType, content) {
    this.blobs[path] = content;
    this.contentTypes[path] = contentType;
  },

  readAdminBlob: async function (path) {
    if (this.blobs[path]) {
      return this.blobs[path];
    } else {
      throw new NoSuchBlobError(`${path} does not exist`);
    }
  },

  metadataAdminBlob: async function (path) {
    if (this.blobs[path]) {
      return { contentType: this.contentTypes[path], contentLength: this.blobs[path]?.length };
    } else {
      throw new NoSuchBlobError(`${path} does not exist`);
    }
  },

  deleteAdminBlob: async function (path) {
    delete this.blobs[path];
    delete this.contentTypes[path];
  },

  listAdminBlobs: async function (prefix) {
    const metadata = [];
    for (const [path, content] of Object.entries(this.blobs || {})) {
      if (path.startsWith(prefix)) {
        metadata.push({ path: path.slice(prefix.length + 1), contentLength: content.length });
      }
    }
    return metadata;
  }
};

describe('admin module', function () {
  before(async function () {
    configureLogger({ log_dir: './test-log', stdout: ['notice'], log_files: ['error'] });
    this.hostIdentity = HOST_IDENTITY;

    this.accountMgr = mockAccountFactory(HOST_IDENTITY);
    this.storeRouter = mockStoreRouter;

    this.jwtSecret = 'fubar';
    this.loginRouter = await loginFactory(this.hostIdentity, this.jwtSecret, this.accountMgr, true);
    this.admin = await adminFactory(this.hostIdentity, this.jwtSecret, this.accountMgr, this.storeRouter);

    this.app = express();
    this.app.locals.basePath = '';
    this.app.set('views', path.join(__dirname, '../../lib/views'));
    this.app.set('view engine', 'html');
    this.app.engine('.html', require('ejs').__express);

    this.app.use(express.urlencoded({ extended: true }));
    const developSession = session({
      name: 'id',
      secret: crypto.randomBytes(32 / 8).toString('base64')
    });
    this.app.use(developSession);
    this.sessionValues = {};
    this.app.use((req, res, next) => { // shim for testing
      Object.assign(req.session, this.sessionValues);
      res.logNotes = new Set();
      next();
    });
    this.app.use('/signup', requestInviteRouter(this.storeRouter));
    this.app.use('/admin', this.loginRouter);
    this.app.use('/admin', this.admin);

    this.app.locals.title = 'Test Armadietto';
    this.app.locals.host = 'localhost:xxxx';
    this.app.locals.signup = true;
  });

  beforeEach(function () {
    this.sessionValues = { privileges: {} };
  });

  describe('generateInviteURL', function () {
    it('throws an error for undefined username & contact string', async function () {
      await expect(this.admin.generateInviteURL(undefined, undefined)).to.eventually.be.rejectedWith(Error, 'contactStr');
    });

    it('throws an error for username w/o contact string', async function () {
      await expect(this.admin.generateInviteURL(undefined, 'robert')).to.eventually.be.rejectedWith(Error, 'contact');
    });

    it('throws an error for tel: URL', async function () {
      await expect(this.admin.generateInviteURL('tel:+1-800-555-1212', undefined)).to.eventually.be.rejectedWith(Error, 'contact user');
    });

    it('returns inviteURL for email address', async function () {
      const [contactURL, inviteURL] = await this.admin.generateInviteURL('foo@bar.com', undefined, { STORE: true });

      expect(contactURL.href).to.equal('mailto:foo@bar.com');
      expect(inviteURL).to.have.property('protocol', 'https:');
      expect(inviteURL).to.have.property('host', this.hostIdentity);
      expect(inviteURL).to.have.property('pathname', '/admin/acceptInvite');
      expect(inviteURL.searchParams.has('token')).to.equal(true);

      const token = inviteURL.searchParams.get('token');
      expect(token).to.match(/^[a-zA-Z0-9_-]{10,64}/);
      const invite = YAML.parse(await this.storeRouter.readAdminBlob(path.join(ADMIN_INVITE_DIR_NAME, token + '.yaml')));
      expect(invite).to.have.property('username', '');
      expect(invite).to.have.property('contactURL', contactURL.href);
      expect(invite).to.have.property('expiresAt');
      expect(new Date(invite.expiresAt) - Date.now()).to.be.greaterThan(60 * 60 * 1000);
      expect(new Date(invite.expiresAt) - Date.now()).to.be.lessThan(48 * 60 * 60 * 1000);
      expect(invite.privileges).to.deep.equal({ STORE: true });
    });

    it('returns inviteURL for sms: URL', async function () {
      const [contactURL, inviteURL] = await this.admin.generateInviteURL('sms:+18664504185?&body=Hi%2520there', undefined);

      expect(contactURL.href).to.equal('sms:+18664504185');

      expect(inviteURL).to.have.property('protocol', 'https:');
      expect(inviteURL).to.have.property('host', this.hostIdentity);
      expect(inviteURL).to.have.property('pathname', '/admin/acceptInvite');
      expect(inviteURL.searchParams.has('token')).to.equal(true);

      const token = inviteURL.searchParams.get('token');
      expect(token).to.match(/^[a-zA-Z0-9_-]{10,64}/);
      const invite = YAML.parse(await this.storeRouter.readAdminBlob(path.join(ADMIN_INVITE_DIR_NAME, token + '.yaml')));
      expect(invite).to.have.property('username', '');
      expect(invite).to.have.property('contactURL', contactURL.href);
      expect(new Date(invite.expiresAt) - Date.now()).to.be.greaterThan(60 * 60 * 1000);
      expect(new Date(invite.expiresAt) - Date.now()).to.be.lessThan(48 * 60 * 60 * 1000);
    });
  });

  describe('bootstrap', function () {
    it('doesn\'t throw exception when BOOTSTRAP_OWNER is undefined', async function () {
      delete process.env.BOOTSTRAP_OWNER;

      await expect(this.admin.bootstrap()).to.eventually.equal(undefined);
    });

    it('doesn\'t throw exception when BOOTSTRAP_OWNER doesn\'t contain URL', async function () {
      process.env.BOOTSTRAP_OWNER = ' fu  bar ';

      await expect(this.admin.bootstrap()).to.eventually.equal(undefined);
    });

    it('writes invite URL to file based on BOOTSTRAP_OWNER environment variable', async function () {
      const username = 'RedKumari';
      const contactStr = 'red@kumari.org';
      await this.storeRouter.deleteAdminBlob(path.join(ADMIN_INVITE_DIR_NAME, `${encodeURIComponent('mailto:' + contactStr)}.uri`));
      process.env.BOOTSTRAP_OWNER = ` ${contactStr}  ${username} `;

      await this.admin.bootstrap();

      const inviteURLFile = await this.storeRouter.readAdminBlob(path.join(ADMIN_INVITE_DIR_NAME, `${encodeURIComponent('mailto:' + contactStr)}.uri`));
      const inviteURL = new URL(inviteURLFile);
      expect(inviteURL.protocol).to.equal('https:');
      expect(inviteURL.host).to.equal(this.hostIdentity);
      expect(inviteURL.pathname).to.equal('/admin/acceptInvite');

      const token = inviteURL.searchParams.get('token');
      expect(token).to.match(/^[a-zA-Z0-9_-]{10,64}/);
      const invite1 = YAML.parse(await this.storeRouter.readAdminBlob(path.join(ADMIN_INVITE_DIR_NAME, token + '.yaml')));
      expect(invite1).to.have.property('username', username);
      expect(invite1).to.have.property('contactURL', 'mailto:' + contactStr);
      expect(invite1.privileges).to.deep.equal({ OWNER: true, ADMIN: true, STORE: true });

      delete process.env.BOOTSTRAP_OWNER;
    });
  });

  describe('sending invitation', function () {
    it('rejects without admin privilege', async function () {
      const res = await chai.request(this.app).post('/admin/sendInvite').type('form').send({
        protocol: 'mailto:',
        address: 'me@myplace.net',
        privilegegrant: JSON.stringify({ STORE: true })
      });
      expect(res).to.have.status(401);
      expect(res.text).to.have.length(0);
    });

    it('rejects missing protocol', async function () {
      this.sessionValues.privileges.ADMIN = true;

      const res = await chai.request(this.app).post('/admin/sendInvite').type('form').send({
        protocol: '',
        address: 'me@myplace.net',
        privilegegrant: JSON.stringify({ STORE: true })
      });
      expect(res).to.have.status(400);
      expect(res).to.have.header('Content-Type', 'text/plain; charset=utf-8');
      expect(res.text).to.contain('Invalid protocol');
    });

    it('rejects missing address', async function () {
      this.sessionValues.privileges.ADMIN = true;

      const res = await chai.request(this.app).post('/admin/sendInvite').type('form').send({
        protocol: 'sgnl:',
        address: '',
        privilegegrant: JSON.stringify({ STORE: true })
      });
      expect(res).to.have.status(400);
      expect(res).to.have.header('Content-Type', 'text/plain; charset=utf-8');
      expect(res.text).to.contain('Missing address');
    });

    it('Generates invite for valid Signal address', async function () {
      this.sessionValues.privileges.ADMIN = true;

      const res = await chai.request(this.app).post('/admin/sendInvite').type('form').send({
        protocol: 'sgnl:',
        address: '206 555 1212',
        privilegegrant: JSON.stringify({ STORE: true })
      });
      expect(res).to.have.status(201);
      expect(res).to.have.header('Content-Type', 'application/json; charset=utf-8');
      expect(res.body.title).to.match(new RegExp(`${HOST_IDENTITY} User Invite`));
      expect(res.body.text).to.match(new RegExp(`You're invited to use remoteStorage to store data on ${HOST_IDENTITY}! To accept, copy and paste this URL into your browser:`));
      expect(res.body.url).to.match(new RegExp(`https://${HOST_IDENTITY}/admin/acceptInvite\\?token=`));
    });

    it('Generates re-invite w/ contacturl', async function () {
      this.sessionValues.privileges.ADMIN = true;
      const USERNAME = 'Bubba';

      const res = await chai.request(this.app).post('/admin/sendInvite').type('form').send({
        username: USERNAME,
        contacturl: 'bubs@bluecollar.com',
        privilegegrant: JSON.stringify({ STORE: true, ADMIN: true })
      });
      expect(res).to.have.status(201);
      expect(res).to.have.header('Content-Type', 'application/json; charset=utf-8');
      expect(res.body.title).to.match(new RegExp(`${HOST_IDENTITY} User Invite`));
      expect(res.body.text).to.match(new RegExp(`${USERNAME}, to create a passkey for ${HOST_IDENTITY} on a new device, copy and paste this URL into the browser on that device:`));
      expect(res.body.url).to.match(new RegExp(`https://${HOST_IDENTITY}/admin/acceptInvite\\?token=`));
    });
  });

  describe('redeeming invitation', function () {
    it('rejects invalid token', async function () {
      const invalidToken = 'nOtAcUrReNtInViTe';
      const inviteURL = new URL('/admin/acceptInvite?token=' + invalidToken, 'https://' + this.hostIdentity);

      const res = await chai.request(this.app).get(inviteURL.pathname + inviteURL.search);
      expect(res).to.have.status(401);
      expect(res).to.have.header('Content-Type', 'text/html; charset=utf-8');
      expect(res.text).to.contain('not valid');
    });

    it('validates token & re-issues to same account', async function () {
      const number = Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
      const contactStr = ` theking${number}@graceland.com `;
      const privileges = { ADMIN: true, STORE: true };
      const [contactURL, inviteURL] = await this.admin.generateInviteURL(contactStr, undefined,
        privileges);

      expect(contactURL.href).to.equal('mailto:' + contactStr.trim());

      const agent = chai.request.agent(this.app);
      const res = await agent.get(inviteURL.pathname + inviteURL.search);

      expect(res).to.have.status(200);
      expect(res).to.have.header('Content-Type', 'text/html; charset=utf-8');
      expect(res.text).to.contain('Welcome!');
      expect(res.text).to.match(new RegExp(`\\b${contactStr.trim()}\\b`));
      expect(res.text).to.match(/Pick a username/i);

      try {
        await this.storeRouter.metadataAdminBlob(path.join(CONTACT_URL_DIR, encodeURIComponent(contactURL) + '.yaml'));
        expect.fail(path.join(CONTACT_URL_DIR, encodeURIComponent(contactURL) + '.yaml') + ' should not exist');
      } catch (err) {
        expect(err.name).to.equal('NoSuchBlobError');
      }

      // re-invite
      const [contactURL2, inviteURL2] = await this.admin.generateInviteURL(contactURL.href, undefined);
      expect(contactURL2).to.deep.equal(contactURL);
      expect(inviteURL2).not.to.deep.equal(inviteURL);

      const token2 = inviteURL2.searchParams.get('token');
      expect(token2).to.match(/^[a-zA-Z0-9_-]{10,64}/);
      const invite2 = YAML.parse(await this.storeRouter.readAdminBlob(path.join(ADMIN_INVITE_DIR_NAME, token2 + '.yaml')));
      expect(invite2).to.have.property('username', '');
      expect(invite2).to.have.property('contactURL', contactURL.href);

      // selects username & creates user
      const username = 'Elvis-' + number;
      const optRes = await agent.post('/admin/getRegistrationOptions').type('application/json').send({ username });
      expect(optRes).to.have.status(201);
      expect(optRes).to.have.header('Content-Type', /^application\/json/);
      const body = JSON.parse(optRes.text);
      expect(body).to.have.nested.property('rp.name', 'psteniusubi.github.io');
      expect(body).to.have.nested.property('user.name', username);
      expect(body).to.have.deep.property('excludeCredentials', []);
      expect(body).to.have.deep.property('authenticatorSelection', {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform',
        requireResidentKey: false
      });
      expect(body).to.have.deep.property('extensions', { credProps: true });
      expect(body).to.have.property('attestation', 'none');

      const usernameRet = await this.storeRouter.readAdminBlob(path.join(CONTACT_URL_DIR, encodeURIComponent(contactURL) + '.yaml'));
      const admin = await this.accountMgr.getUser(usernameRet, new Set());
      expect(admin).to.have.property('username', username);
      expect(admin).to.have.property('contactURL', contactURL.href);
      expect(admin).to.have.deep.property('privileges', privileges);
      expect(admin).to.have.property('credentials');

      await agent.close();
    });

    it('matches invite to existing account', async function () {
      const number = Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
      const username1 = 'Leo';
      const contactStr = ` graf${number}@galactech.com `;
      const privileges = { ADMIN: true, STORE: true };

      const [contactURL1, inviteURL1] = await this.admin.generateInviteURL(contactStr, username1, privileges);
      const agent = chai.request.agent(this.app);
      const res1 = await agent.get(inviteURL1.pathname + inviteURL1.search);
      expect(res1).to.have.status(200);

      const optRes1 = await agent.post('/admin/getRegistrationOptions').type('application/json').send({ });
      expect(optRes1).to.have.status(201);
      const body1 = JSON.parse(optRes1.text);
      expect(body1).to.have.nested.property('user.name', username1);
      const admin = await this.accountMgr.getUser(username1, new Set());
      expect(admin).has.property('username', username1);
      expect(admin).has.property('contactURL', contactURL1.href);
      expect(admin).to.have.deep.property('privileges', { ADMIN: true, STORE: true });

      // re-invites w/ same contact URL but no username
      const [contactURL2, inviteURL2] = await this.admin.generateInviteURL(contactURL1.href, undefined);
      expect(contactURL2.href).to.deep.equal('mailto:' + contactStr.trim());
      expect(inviteURL2).not.to.deep.equal(inviteURL1);

      const token2 = inviteURL2.searchParams.get('token');
      expect(token2).to.match(/^[a-zA-Z0-9_-]{10,64}$/);
      const invite2 = YAML.parse(await this.storeRouter.readAdminBlob(path.join(ADMIN_INVITE_DIR_NAME, token2 + '.yaml')));
      expect(invite2).to.have.property('contactURL', contactURL1.href);

      const res2 = await chai.request(this.app).get(inviteURL2.pathname + inviteURL2.search);
      expect(res2).to.have.status(200);
      expect(res2.text).to.match(new RegExp(`\\bWelcome, ${username1}!`));
      expect(res2.text).to.match(/Create a passkey/i);
      expect(res2.text).not.to.match(/Pick a username/i);
      expect(res2.text).to.match(new RegExp(`value="${username1}"`, 'i'));

      // gets options for existing user
      const optRes2 = await agent.post('/admin/getRegistrationOptions').type('application/json').send({});
      expect(optRes2).to.have.status(200);
      expect(optRes2).to.have.header('Content-Type', /^application\/json/);
      const body2 = JSON.parse(optRes2.text);
      expect(body2).to.have.nested.property('rp.name', 'psteniusubi.github.io');
      expect(body2).to.have.nested.property('user.name', username1);
      expect(body2).to.have.deep.property('excludeCredentials', []);
      expect(body2).to.have.deep.property('authenticatorSelection', {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform',
        requireResidentKey: false
      });
      expect(body2).to.have.deep.property('extensions', { credProps: true });
      expect(body2).to.have.property('attestation', 'none');

      const usernameContact = await this.storeRouter.readAdminBlob(path.join(CONTACT_URL_DIR, encodeURIComponent(contactURL1) + '.yaml'));
      expect(usernameContact).to.equal(username1);
    });

    it('rejects expired token', async function () {
      const number = Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
      const username = 'Bob-' + number;
      const contactStr = ` bob${number}@robert.com `;
      const [_, inviteURL] = await this.admin.generateInviteURL(contactStr, username);

      const token = inviteURL.searchParams.get('token');
      const invite = YAML.parse(await this.storeRouter.readAdminBlob(path.join(ADMIN_INVITE_DIR_NAME, token + '.yaml')));
      invite.expiresAt = new Date(Date.now() - 1);
      await this.storeRouter.upsertAdminBlob(path.join(ADMIN_INVITE_DIR_NAME, token + '.yaml'), YAML.stringify(invite));

      const res = await chai.request(this.app).get(inviteURL.pathname + inviteURL.search);
      expect(res).to.have.status(401);
    });
  });

  describe('cancelling invitation', function () {
    it('succeeds for invalid token', async function () {
      const invalidToken = 'nOtAcUrReNtInViTe';
      const inviteURL = new URL('/admin/cancelInvite?token=' + invalidToken, 'https://' + this.hostIdentity);

      const res = await chai.request(this.app).post(inviteURL.pathname + inviteURL.search);
      expect(res).to.have.status(200);
      expect(res).to.have.header('Content-Type', 'application/json; charset=utf-8');
    });

    it('removes invitation file for valid token', async function () {
      const number = Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
      const username = 'Jackie-' + number;
      const contactStr = ` theduke${number}@nationalgallery.org `;
      const [contactURL, inviteURL] = await this.admin.generateInviteURL(contactStr, username);
      expect(contactURL.href).to.equal('mailto:' + contactStr.trim());

      const res = await chai.request(this.app).get(inviteURL.pathname + inviteURL.search);
      expect(res).to.have.status(200);

      const token = inviteURL.searchParams.get('token');
      await expect(this.storeRouter.readAdminBlob(path.join(ADMIN_INVITE_DIR_NAME, token + '.yaml'))).to.eventually.match(new RegExp(`username: ${username}`));

      const cancelRes = await chai.request(this.app).post('/admin/cancelInvite?token=' + token);
      expect(cancelRes).to.have.status(200);

      await expect(this.storeRouter.readAdminBlob(path.join(ADMIN_INVITE_DIR_NAME, token + '.yaml'))).to.eventually.be.rejectedWith(NoSuchBlobError);
    });
  });

  // ----------------------- implemented by login router -------------------------------------------

  describe('login page', function () {
    it('displays messages & contains options', async function () {
      const res = await chai.request(this.app).get('/admin/login');
      expect(res).to.have.status(200);
      expect(res).to.have.header('Content-Type', 'text/html; charset=utf-8');
      const resText = res.text.replace(/&#34;/g, '"');
      expect(resText).to.contain('<h1>Start Admin Session</h1>');
      expect(resText).to.contain('<p id="message">select a passkey</p>');
      expect(resText).to.contain('"challenge":"');
      expect(resText).to.contain('"userVerification":"preferred"');
      expect(resText).to.contain('"rpId":"psteniusubi.github.io"');
    });
  });

  describe('verification of passkeys', function () {
    it('rejects an unregistered passkey as a bad request', async function () {
      this.sessionValues.loginChallenge = LOGIN_CHALLENGE;
      const verifyRes = await chai.request(this.app).post('/admin/verify-authentication')
        .type('application/json').send(JSON.stringify(CREDENTIAL_PRESENTED_WRONG));
      expect(verifyRes).to.have.status(401);
      expect(verifyRes).to.be.json;
      expect(verifyRes.body.msg).to.match(/could not be validated/);
    });

    it('accepts a registered passkey', async function () {
      this.sessionValues.loginChallenge = LOGIN_CHALLENGE;
      const verifyRes = await chai.request(this.app).post('/admin/verify-authentication')
        .type('application/json').send(JSON.stringify(CREDENTIAL_PRESENTED_RIGHT));
      expect(verifyRes).to.have.status(200);
      expect(verifyRes).to.be.json;
      expect(verifyRes.body.verified).to.equal(true);
      expect(verifyRes.body.username).to.equal(USER.username);
    });
  });

  describe('users list', function () {
    beforeEach(function () {
      this.sessionValues.privileges.ADMIN = true;
    });

    it('should display users', async function () {
      const res = await chai.request(this.app).get('/admin/users');
      expect(res).to.have.status(200);
      expect(res.text).to.contain('<h1>Users</h1>');
      expect(res.text).to.contain('<td>FirstUser');
      expect(res.text).to.contain('<td>mailto:​foo@bar.co</td>');
      expect(res.text).to.contain('<td>SecondUser');

      expect(res.text).to.contain('<label for="protocol" class="overLabel">Protocol</label>');
      expect(res.text).to.contain('<select name="protocol" id="protocol" value="" required>');
      expect(res.text).to.match(/<label for="address" class="overLabel">[a-zA-Z ]+<\/label>/);
      expect(res.text).to.match(/<input type="(text|tel|email)" id="address" name="address" value=""\s+placeholder="\P{Cc}+" required pattern="[ -~]+"/mu);
      expect(res.text).to.match(/<button [^>]*type="submit"[^>]*>Create User Invitation<\/button>/);
    });
  });

  describe('invite request list', function () {
    beforeEach(function () {
      this.sessionValues.privileges.ADMIN = true;
    });

    it('should display invite request contact URL and invite & delete buttons', async function () {
      let res = await chai.request(this.app).post('/signup').type('form').send({
        protocol: 'xmpp:',
        address: 'mine@jabber.org'
      });
      expect(res).to.have.status(201);
      res = await chai.request(this.app).post('/signup').type('form').send({
        protocol: 'sgnl:',
        address: '(509) 555-1212)'
      });
      expect(res).to.have.status(201);

      res = await chai.request(this.app).get('/admin/inviteRequests');
      expect(res).to.have.status(200);
      const resText = res.text.replace(/&#34;/g, '"');
      expect(resText).to.contain('<h1>Requests for Invitation</h1>');
      expect(resText).to.contain('<td>xmpp:mine@jabber.org');
      expect(resText).to.match(/<button[^>]*>Invite<\/button>/);
      expect(resText).to.contain('data-contacturl="xmpp:mine@jabber.org"');
      expect(resText).to.contain('data-privilegegrant="{"STORE":true}"');
      expect(resText).to.match(/<button[^>]*>Delete<\/button>/);
      expect(resText).to.contain('<td>sgnl://signal.me/#p/+15095551212');
      expect(resText).to.contain('data-contacturl="sgnl://signal.me/#p/+15095551212"');
    });

    it('removes request file, when button clicked', async function () {
      const number = Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
      const email = `j${number}@industry.com`;
      let res = await chai.request(this.app).post('/signup').type('form').send({
        protocol: 'mailto:',
        address: email
      });
      expect(res).to.have.status(201);

      const contacturl = 'mailto:' + email;
      const filePath = path.join(INVITE_REQUEST_DIR, encodeURIComponent(contacturl) + '.yaml');
      await expect(this.storeRouter.readAdminBlob(filePath)).to.eventually.equal(contacturl);

      res = await chai.request(this.app).post('/admin/deleteInviteRequest').type('form').send({
        contacturl
      });
      expect(res).to.have.status(200);

      await expect(this.storeRouter.readAdminBlob(filePath)).to.eventually.be.rejectedWith(NoSuchBlobError);
    });
  });
});
