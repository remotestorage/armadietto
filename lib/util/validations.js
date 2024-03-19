/** each streaming store decides what user names are valid, and may use its own password validation if desired. */

module.exports = {
  EMAIL_PATTERN: /[\p{L}\p{N}]@[a-zA-Z0-9][a-zA-Z0-9.]/u,
  EMAIL_ERROR: 'Email must contain an alphanumeric, followed by an @-sign, followed by two ASCII alphanumerics',
  PASSWORD_PATTERN: /\S{8,}/,
  PASSWORD_ERROR: 'Password must contain at least 8 non-space characters'
};
