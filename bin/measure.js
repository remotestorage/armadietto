/* eslint-env node, browser */

const yargs = require('yargs');
const { userDbName, delay } = require('../spec/util/test_util_node14');
const { streamFactory } = require('../spec/util/test_util');

const clientId = 'http://example.com';

const argv = yargs
  .option('origin', {
    alias: 'o',
    description: 'base URL of the server',
    type: 'string',
    default: process.env.SERVER_URL || 'http://127.0.0.1:8000'
  })
  .option('size', {
    alias: 's',
    description: 'size (in bytes) of rapid requests',
    type: 'number',
    default: 4000
  })
  .option('delay', {
    alias: 'd',
    description: 'how long (in ms) to wait between requests',
    type: 'number',
    default: 10
  })
  .option('max', {
    alias: 'm',
    description: 'maximum number of requests',
    type: 'number',
    default: 2000
  })
  .option('username', {
    alias: 'u',
    description: 'name of user',
    type: 'string',
    default: process.env.USERNAME || 'stressuser'
  })
  .option('password', {
    alias: 'p',
    description: 'password of user',
    type: 'string',
    default: process.env.PASSWORD || 'kladljkfdsoi983'
  })
  .help()
  .alias('help', 'h')
  .argv;

measure(argv.origin, argv.size, argv.delay, argv.max, argv.username, argv.password)
  .then(result => {
    console.info(`first failure: ${result.firstFailure}   longest run length: ${result.longestRunLength}   num: ${result.num}`);
    console.info(`delete time: ${result.deleteTimeNs / 1_000_000_000} s   create time: ${result.createTimeNs / 1_000_000_000} s`);
    // console.log(`statuses: ${result.statuses}`)
  })
  .catch(err => console.error('error:', err));

async function measure (origin, size, delayMs, max, username, password) {
  const url = new URL('/oauth', origin).href;
  const param = new URLSearchParams({
    client_id: clientId,
    redirect_uri: clientId + '/',
    response_type: 'token',
    state: '5d0176aa',
    scope: '/:rw',
    username,
    password,
    allow: 'Allow'
  });
  console.info(`logging in to ${url} username “${username}” scope “/:rw”`);
  const resp = await fetch(url, { method: 'POST', body: param });
  let token;
  if (resp.redirected) {
    const respUrl = new URL(resp.url);
    const respParam = new URLSearchParams(respUrl.hash.slice(1));
    token = respParam.get('access_token');
  } else {
    if (resp.status === 401) {
      throw new Error(`Does the password match the username? ${origin} ${resp.status} ${resp.statusText}`);
    } else {
      throw new Error(`${origin} didn't redirect; ${resp.status} ${resp.statusText} ${(await resp.text()).slice(0, 60)}`);
    }
  }
  console.info(`using ${username} (CouchDB database ${userDbName(username)})`);

  const directoryName = 'many';
  const puts = [];
  let firstFailure = Number.POSITIVE_INFINITY;
  let deleteTimeNs, createStart;
  try {
    deleteTimeNs = await deleteAll(directoryName, max);

    console.info(`creating ${max} documents of ${size} bytes in “${directoryName}” at ${delayMs} ms intervals`);
    let i = 0;
    createStart = process.hrtime.bigint();
    do {
      doPut(directoryName, i); // Intentionally doesn't await
      await delay(delayMs);
      ++i;
    } while (firstFailure === Number.POSITIVE_INFINITY && i < max);

    await Promise.allSettled(puts);
  } catch (err) {
    let msg = `while awaiting put of ${size} byte document\n    ${err.name}  ${err.code}  ${err.message}`;
    if (err.cause) {
      msg += ` -> ${err.cause?.name}  ${err.cause?.code}  ${err.cause?.message}`;
    }
    console.error(msg);
  }
  const createTimeNs = Number(process.hrtime.bigint() - createStart);

  let runStart = 0;
  let longestRunLength = 0;
  let j = 0;
  do {
    if (puts[j] !== 200 && puts[j] !== 201) {
      const thisRunLength = j - runStart;
      if (thisRunLength > longestRunLength) {
        longestRunLength = thisRunLength;
      }
      runStart = j + 1;
    }
    ++j;
    if (j === puts.length) {
      const thisRunLength = j - runStart;
      if (thisRunLength > longestRunLength) {
        longestRunLength = thisRunLength;
      }
    }
  } while (j < puts.length);

  return { firstFailure, longestRunLength, num: puts.length, statuses: puts, deleteTimeNs, createTimeNs };

  async function doPut (directoryName, i) {
    try {
      const path = `/storage/${username}/${directoryName}/${i}`;
      const promise = fetch(new URL(path, origin), {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'text/plain' },
        body: streamFactory(size, i)
      }
      );
      puts[i] = promise;
      const result = await promise;
      puts[i] = result.status;
      if (!result.ok) {
        if (i < firstFailure) {
          firstFailure = i;
        }
        if (result.status !== 429) {
          console.warn(`${i} ${result.status} ${result.statusText}`);
        }
      }
    } catch (err) { // probably a network failure
      puts[i] = err.cause?.name || err.cause?.code || err.cause?.message || err.name || err.code || err.message;
      if (i < firstFailure) {
        firstFailure = i;
      }
      console.warn(i, puts[i]);
    }
  }

  async function deleteAll (directoryName, max) {
    console.info(`deleting ${max} documents in “${directoryName}”`);
    const deleteBegin = process.hrtime.bigint();
    for (let i = 0; i < max; ++i) {
      try {
        const path = `/storage/${username}/${directoryName}/${i}`;
        const result = await fetch(new URL(path, origin), {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'text/plain' }
        }
        );
        if (!result.ok && result.status !== 404) {
          console.error(`Can't delete ${i}: ${result.status} ${result.statusText}`);
        }
      } catch (err) {
        console.error(`Can't delete ${i}: ${err.cause?.name || err.cause?.code || err.cause?.message || err.name || err.code || err.message}`);
      }
    }

    return Number(process.hrtime.bigint() - deleteBegin);
  }
}
