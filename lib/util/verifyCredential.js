const { verifyAuthenticationResponse } = require('@simplewebauthn/server');

/**
 * Returns authenticationInfo or throws error if not valid
 * @param user
 * @param expectedChallenge
 * @param expectedOrigin
 * @param expectedRPID
 * @param presentedCredential
 * @returns {Promise<Object>} authenticationInfo
 */
module.exports = async function verifyCredential (user, expectedChallenge, expectedOrigin, expectedRPID, presentedCredential) {
  const storedCredential = user.credentials[presentedCredential.id];
  if (!storedCredential) {
    throw new Error('Presented credential does not belong to user.');
  }

  // Base64URL decodes some values
  const memoryCredential = {
    credentialPublicKey: Buffer.from(storedCredential.credentialPublicKey, 'base64url'),
    credentialID: Buffer.from(storedCredential.credentialID),
    transports: storedCredential.transports
  };

  // Verifies the credential
  const { verified, authenticationInfo } = await verifyAuthenticationResponse({
    response: presentedCredential,
    expectedChallenge,
    expectedOrigin,
    expectedRPID,
    authenticator: memoryCredential,
    requireUserVerification: false
  });
  if (!verified) {
    throw new Error('Credential verification failed.');
  }
  return authenticationInfo;
};
