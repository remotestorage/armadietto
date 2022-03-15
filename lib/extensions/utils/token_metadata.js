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

module.exports = { metadataUpsert, metadataDelete, getMetadata };
