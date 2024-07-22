const proquint = require('proquint');
const { randomBytes } = require('node:crypto');
const { calcContactURL } = require('../../lib/util/protocols');
const NoSuchUserError = require('../../lib/util/NoSuchUserError');

const CREDENTIAL_STORED = {
  fmt: 'none',
  counter: 0,
  aaguid: 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd',
  credentialID: 'g6PMuH2JOSapWYYIXihRmBxtqvQ',
  credentialPublicKey: 'pQECAyYgASFYINDLzLfpl_9XwI-ZrBRe3IZDU7lhsCBKuFGH14sOQbLdIlggtqqF5bxIO53sylxsjRN6lTZO58wCx7BbQoUOyauIcGw',
  credentialType: 'public-key',
  attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YViYLNeTz6C0GMu_DqhSIoYH2el7Mz1NsKQQF3Zq9ruMdVFZAAAAAPv8MAcVTk7MjAtuAgVX170AFIOjzLh9iTkmqVmGCF4oUZgcbar0pQECAyYgASFYINDLzLfpl_9XwI-ZrBRe3IZDU7lhsCBKuFGH14sOQbLdIlggtqqF5bxIO53sylxsjRN6lTZO58wCx7BbQoUOyauIcGw',
  userVerified: false,
  credentialDeviceType: 'multiDevice',
  credentialBackedUp: true,
  origin: 'https://psteniusubi.github.io',
  rpID: 'psteniusubi.github.io',
  transports: ['internal'],
  name: 'Apple Mac Firefox',
  createdAt: '2024-05-09T03:08:12.272Z'
};
const USER = {
  username: 'nisar-dazan-dafig-kanih',
  storeId: 'nisar-dazan-dafig-kanih-psteniusubi.github.io',
  contactURL: 'skype:skye',
  privileges: { STORE: true },
  credentials: {
    g6PMuH2JOSapWYYIXihRmBxtqvQ: CREDENTIAL_STORED
  }
};
const CREDENTIAL_PRESENTED_RIGHT = {
  id: 'g6PMuH2JOSapWYYIXihRmBxtqvQ',
  type: 'public-key',
  rawId: 'g6PMuH2JOSapWYYIXihRmBxtqvQ',
  response: {
    clientDataJSON: 'eyJjaGFsbGVuZ2UiOiJtSlhFUlNCZXRMLU5STDdBTW96ZVdmbm9iWGsiLCJvcmlnaW4iOiJodHRwczovL3BzdGVuaXVzdWJpLmdpdGh1Yi5pbyIsInR5cGUiOiJ3ZWJhdXRobi5nZXQifQ',
    authenticatorData: 'LNeTz6C0GMu_DqhSIoYH2el7Mz1NsKQQF3Zq9ruMdVEZAAAAAA',
    signature: 'MEUCIGA31yAgnz8lLekbOOYWY01AujsCN1zr4Eci9C5ztVuMAiEAuNwvr8PsUT_1EwoJ8AaR5qCIB4TfmhJSRuzIz0pSM68',
    userHandle: Buffer.from(USER.username, 'utf8').toString('base64url')
  }
};
const CREDENTIAL_PRESENTED_RIGHT_NO_USERHANDLE = structuredClone(CREDENTIAL_PRESENTED_RIGHT);
CREDENTIAL_PRESENTED_RIGHT_NO_USERHANDLE.response.userHandle = undefined;
const CREDENTIAL_PRESENTED_WRONG = {
  id: 'E1wdWNIfF6QkykG4Nmmknb74tKQ',
  rawId: 'E1wdWNIfF6QkykG4Nmmknb74tKQ',
  response: {
    authenticatorData: 'YbDxlQWOWRoWT1ph2oX7NZMyBCil85aW7pEHf8Y51GAZAAAAAA',
    clientDataJSON: 'eyJjaGFsbGVuZ2UiOiJxdi1Xb25zY2h2aG5vNkM4SlZiZklCUHYxRTJkU3JGVDhra21RejlFYnZ3Iiwib3JpZ2luIjoiaHR0cHM6Ly9tb2EubG9jYWwiLCJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
    signature: 'MEQCIERYO7mqEcmu7py-_kMTONYTfjDuTPn8E5TUmF25NvXQAiB1IV-_Q-o8fdq7qBRFJ805CUAhzQPTupcd3shTjtEu9Q',
    userHandle: Buffer.from(USER.username, 'utf8').toString('base64url')
  },
  type: 'public-key',
  clientExtensionResults: {},
  authenticatorAttachment: 'platform'
};

module.exports = {
  USER,
  CREDENTIAL_STORED,
  CREDENTIAL_PRESENTED_RIGHT,
  CREDENTIAL_PRESENTED_RIGHT_NO_USERHANDLE,
  CREDENTIAL_PRESENTED_WRONG,

  mockAccountFactory: function (hostIdentity) {
    const users = {};
    users[USER.username] = USER;

    return {
      createUser: async (params, logNotes) => {
        const username = params.username || proquint.encode(randomBytes(Math.ceil(64 / 16) * 2));
        const storeId = (username + '-' + hostIdentity).slice(0, 63);
        const contactURL = calcContactURL(params.contactURL).href; // validates & normalizes
        const normalizedParams = { ...params, username, contactURL };

        const user = { privileges: {}, ...normalizedParams, storeId, credentials: {} };
        users[user.username] = user;
        logNotes.add(`allocated storage for user “${username}”`);
        return user;
      },
      listUsers: async () => [
        { username: 'FirstUser', contactURL: 'mailto:foo@bar.co', storeId: 'firstuser-' + hostIdentity, privileges: { ADMIN: true } },
        { username: 'SecondUser', contactURL: 'mailto:spam@frotz.edu', storeId: 'seconduser-' + hostIdentity }
      ],
      getUser: async (username, _logNotes) => {
        if (username in users) {
          return users[username];
        } else {
          throw new NoSuchUserError(`No user "${username}"`);
        }
      },
      updateUser: async (user, _logNotes) => {
        if (user.username in users) {
          users[user.username] = { ...user };
        } else {
          throw new NoSuchUserError(`No user "${user.username}"`);
        }
      }
    };
  }
};
