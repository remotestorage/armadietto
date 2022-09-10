/* eslint-env node, browser */

function userDbName (username) {
  return 'userdb-' + Buffer.from(username).toString('hex');
}

function delay (ms) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

module.exports = { userDbName, delay };
