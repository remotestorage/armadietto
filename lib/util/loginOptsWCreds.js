const { generateAuthenticationOptions } = require('@simplewebauthn/server');

module.exports = async function loginOptsWCreds (username = undefined, user = undefined, accountMgr, rpID, logNotes) {
  let allowCredentials = []; // user selects from browser-generated list
  if (username && !user) {
    user = await accountMgr.getUser(username, logNotes);
  }
  if (user) {
    allowCredentials = Object.values(user.credentials || {}).map(
      cred => ({
        id: Buffer.from(cred.credentialID, 'base64url'),
        transports: cred.transports,
        type: cred.credentialType
      })
    );
  }
  return await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: 'preferred', // Typically will ask for biometric, but not password.
    timeout: 5 * 60 * 1000
  });
};
