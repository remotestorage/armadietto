// cleanup.js — utilities for cleaning up after tests
// Copyright © 2026 Doug Reeder

/**
 *
 * @param {*} accountMgr
 * @param {string[]} usernames
 * @returns {Promise<{[p: string]: PromiseSettledResult<Awaited<*>>, [p: number]: PromiseSettledResult<Awaited<*>>, [p: symbol]: PromiseSettledResult<Awaited<*>>}>}
 */
async function deleteUsersLoggingFailures (accountMgr, usernames) {
  const logNotes = new Set();
  const results = await Promise.allSettled(usernames.map(
    username => accountMgr.deleteUser(username, logNotes)
  ));
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      logNotes.add(`Failed to delete user “${usernames[i]}”: ${results[i].reason}`);
    }
  }
  if (results.some(r => r.status === 'rejected')) {
    console.warn('Cleanup:', Array.from(logNotes).join(' '));
  }
}

module.exports = { deleteUsersLoggingFailures };
