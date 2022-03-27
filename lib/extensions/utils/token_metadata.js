const qs = require('querystring');
const AUTH_REGEX = /^([^,]+)/;
const METADATA_REGEX = /,metadata=([^,]*)/;

/**
 * Upsert a metadata into the token
 *
 * @param {string} token - the raw token tow work with
 * @param {string} key - the metadata key
 * @param {string} value - the metadata value
 * @returns {string} the token with metadata amended
 */
function metadataUpsert (token, key, value) {
  const matched = token.match(METADATA_REGEX);
  let metadata = {};

  if (matched) {
    metadata = JSON.parse(Buffer.from(matched[1], 'base64').toString());
  }

  metadata[key] = value;

  const strippedToken = token.replace(METADATA_REGEX, '');
  const newmetadata = Buffer.from(JSON.stringify(metadata)).toString('base64');

  return `${strippedToken},metadata=${newmetadata}`;
}

/**
 * Delete a metadata from the token
 *
 * @param {string} token - the raw token tow work with
 * @param {string} key - the metadata key
 * @returns {string} the token with metadata deleted, returns token sans metadata_REGEX if no metadata
 */
function metadataDelete (token, key) {
  const matched = token.match(METADATA_REGEX);

  if (!matched) return token;

  const metadata = JSON.parse(Buffer.from(matched[1], 'base64').toString());
  delete metadata[key];
  const strippedToken = token.replace(METADATA_REGEX, '');

  if (Object.keys(metadata).length === 0) return strippedToken;

  const newmetadata = Buffer.from(JSON.stringify(metadata)).toString('base64');
  return `${strippedToken},metadata=${newmetadata}`;
}

/**
 * Get all metadata from the token
 *
 * @param {string} token - the raw token tow work with
 * @returns {*} the metadata object
 */
function getMetadata (token) {
  const matched = token.match(METADATA_REGEX);
  let metadata = {};

  if (matched) {
    metadata = JSON.parse(Buffer.from(matched[1], 'base64').toString());
  }

  return metadata;
}

/**
 * Get all the auth token, sans metadata/claims
 *
 * @param {string} token - the raw token tow work with
 * @returns {*} the auth token
 */
function getAuthToken (token) {
  const matched = token.match(AUTH_REGEX);

  if (matched) {
    return matched[1];
  }

  return null;
}

/**
 * Push a key/value as a piece of metadata or claim into the bearer token as being returned
 * out  within redirected Location header.
 * @param {*} candidateResponse -- to amend Location header of
 * @param {*} key - key to add
 * @param {*} value - value to add for key
 */
function responseLocationPush (candidateResponse, key, value) {
  const location = candidateResponse.headers.Location;
  if (!location) return;
  const preamble = location.split('#')[0];
  const coded = location.split('#')[1];
  const decoded = qs.parse(coded);
  const token = decoded.access_token;
  const updatedToken = metadataUpsert(token, key, value);
  const newcoded = { ...decoded, access_token: updatedToken };
  const encoded = qs.stringify(newcoded);
  candidateResponse.headers.Location = `${preamble}#${encoded}`;
}

/**
 * Pop a piece of metadata or claim from the bearer token in the provided request, by key.
 * @param {*} request -- request with bearer token to adjust
 * @param {*} key -- key to remove from the token
 * @returns {[metadat, token]} the whole metadata object before removal as first, the auth token as second
 */
function bearerTokenPop (request, key) {
  let tokenMetadata = {};
  let authToken = null;
  if (request.headers.authorization) {
    const token = decodeURIComponent(request.headers.authorization.split(/\s+/)[1]);
    tokenMetadata = getMetadata(token);
    authToken = getAuthToken(token);
    const updatedToken = metadataDelete(token, key);
    request.headers.authorization = `Bearer ${updatedToken}`;
  }
  return [tokenMetadata, authToken];
}

module.exports = { responseLocationPush, bearerTokenPop };
