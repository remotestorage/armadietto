const crypto = require('crypto');
const promisify = require('util').promisify;
const path = require('path');

const pbkdf2 = promisify(crypto.pbkdf2);

const core = {
  VALID_PATH: /^\/([a-z0-9%.\-_]+\/?)*$/i,
  VALID_NAME: /^[a-z0-9%.\-_]+$/,
  hashRounds: 10000,

  traversePath (currentPath) {
    let upperBasename;
    const paths = [];
    while (currentPath !== '') {
      upperBasename = path.basename(currentPath);
      currentPath = currentPath.substring(0, currentPath.length - upperBasename.length - 1);
      paths.push({ currentPath, upperBasename });
    }
    return paths;
  },

  generateToken () {
    return crypto.randomBytes(160 / 8).toString('base64');
  },

  async hashPassword (password, config) {
    config = config || {
      salt: crypto.randomBytes(16).toString('base64'),
      work: core.hashRounds,
      keylen: 64
    };

    const key = await pbkdf2(password, config.salt,
      parseInt(config.work, 10),
      parseInt(config.keylen, 10), 'sha512');

    config.key = key.toString('base64');
    return config;
  },

  parents (path, includeSelf) {
    const query = core.parsePath(path);
    const parents = [];

    if (includeSelf) parents.push(query.join(''));
    query.pop();

    while (query.length > 0) {
      parents.push(query.join(''));
      query.pop();
    }
    return parents;
  },

  parsePath (path) {
    const query = path.match(/[^/]*(\/|$)/g);
    return query.slice(0, query.length - 1);
  },

  validateUser (params) {
    const errors = [];
    const username = params.username || '';
    const email = params.email || '';
    const password = params.password || '';
    if (username.length < 2) { errors.push(new Error('Username must be at least 2 characters long')); }

    if (!core.isValidUsername(username)) { errors.push(new Error('Usernames may only contain letters, numbers, dots, dashes and underscores')); }

    if (!email) { errors.push(new Error('Email must not be blank')); }

    if (!/^.+@.+\..+$/.test(email)) { errors.push(new Error('Email is not valid')); }

    if (!password) { errors.push(new Error('Password must not be blank')); }

    return errors;
  },

  isValidUsername (username) {
    if ((!username) || (username === '..')) return false;
    return core.VALID_NAME.test(username);
  }
};

module.exports = core;
