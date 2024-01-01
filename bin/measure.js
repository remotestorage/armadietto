/* eslint-env node, browser */

const majorVersion = parseInt(process.versions.node.split('.')[0]);
if (majorVersion <= 14) {
  console.error('This requires Node v16 or higher and the flag --experimental-fetch');
  process.exit(1);
}

const yargs = require('yargs');
const { userDbName, delay } = require('../spec/util/test_util_node14');

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
  .option('numusers', {
    alias: 'n',
    description: 'number of users',
    type: 'number',
    default: 12
  })
  .option('username', {
    alias: 'u',
    description: 'base name of users',
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

const usernames = [];
for (let i = 0; i < argv.numusers; ++i) {
  usernames.push(argv.username + i);
}

measure(argv.origin, argv.size, argv.delay, argv.max, usernames, argv.password)
  .then(result => {
    console.info(`delete time: ${result.deleteTimeNs / 1_000_000_000} s   create time: ${result.createTimeNs / 1_000_000_000} s`);
    console.info(`first failure: ${result.firstFailure}   longest run length: ${result.longestRunLength}   num: ${result.num}`);
    // console.log(`statuses: ${result.statuses}`)
  })
  .catch(err => console.error('error:', err));

async function measure (origin, size, delayMs, max, usernames, password) {
  const url = new URL('/oauth', origin).href;
  console.info(`Logging in to ${url} & requesting scope “/:rw”`);
  const credentials = [];
  for (let u = 0; u < usernames.length; ++u) {
    const username = usernames[u];
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
    const resp = await fetch(url, { method: 'POST', body: param, redirect: 'manual' });
    const location = resp.headers.get('Location');
    if (resp.status === 302 && location) {
      const locationUrl = new URL(location);
      const respParam = new URLSearchParams(locationUrl.hash.slice(1));
      const token = respParam.get('access_token');
      if (token) {
        credentials.push({ username, token });
        console.info(`Using ${username} (CouchDB database ${userDbName(username)})`);
      } else {
        console.error('Redirected, but no token. Is the server correctly configured?');
      }
    } else {
      if (resp.status === 401) {
        console.error(`Does the password match username “${username}”? ${origin} ${resp.status} ${resp.statusText}`);
      } else {
        console.error(`${origin} didn't redirect; ${resp.status} ${resp.statusText} ${(await resp.text()).slice(0, 60)}`);
      }
    }
  }

  if (credentials.length === 0) {
    throw new Error('Password not valid for any users');
  } else if (credentials.length < usernames.length) {
    console.info(`Proceeding with ${credentials.length} users`);
  }

  const directoryName = 'many';
  const puts = [];
  let firstFailure = Number.POSITIVE_INFINITY;
  let deleteTimeNs, createStart;
  try {
    deleteTimeNs = await deleteAll(credentials, directoryName, max);

    console.info(`Creating ${max} documents of ${size} bytes among ${credentials.length} users in “${directoryName}” at ${delayMs} ms intervals`);
    let i = 0;
    createStart = process.hrtime.bigint();
    do {
      doPut(credentials[i % credentials.length], directoryName, i); // Intentionally doesn't await
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

  async function doPut (credential, directoryName, i) {
    try {
      const path = `/storage/${credential.username}/${directoryName}/${Math.floor(i / credentials.length)}`;
      const promise = fetch(new URL(path, origin), {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + credential.token, 'Content-Type': 'text/plain' },
        body: streamFactory(size, i),
        duplex: 'half'
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

  async function deleteAll (credentials, directoryName, max) {
    console.info(`Deleting ${Math.ceil(max / credentials.length) * credentials.length} documents among ${credentials.length} users in “${directoryName}”`);
    const deleteBegin = process.hrtime.bigint();
    for (let i = 0; i < Math.ceil(max / credentials.length); ++i) {
      const promises = [];
      for (let j = 0; j < credentials.length; ++j) {
        const path = `/storage/${credentials[j].username}/${directoryName}/${i}`;
        promises[j] = fetch(new URL(path, origin), {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + credentials[j].token, 'Content-Type': 'text/plain' }
        }
        ).then(result => {
          if (!result.ok && result.status !== 404) {
            console.error(`Can't delete ${credentials[j].username} ${i}: ${result.status} ${result.statusText}`);
          }
        }).catch(err => {
          console.error(`Can't delete ${credentials[j].username} ${i}: ${err.cause?.name || err.cause?.code || err.cause?.message || err.name || err.code || err.message}`);
        });
      }
      await Promise.allSettled(promises);
    }

    return Number(process.hrtime.bigint() - deleteBegin);
  }
}

const CHUNK_SIZE = 1024;
const encoder = new TextEncoder();

function streamFactory (targetSize, seed = 1) {
  let count = 0;

  const stream = new ReadableStream({
    type: 'bytes',
    autoAllocateChunkSize: CHUNK_SIZE,
    pull (controller) {
      if (controller.byobRequest) { // zero-copy
        const numRemaining = targetSize - count;
        const view = controller.byobRequest.view; // Uint8Array(256)
        const numToWrite = Math.min(view.length, numRemaining);
        // console.log(`direct-writing min(${view.length}, ${numRemaining}) bytes`);

        encoder.encodeInto(someChars(numToWrite, seed), view);
        count += numToWrite;
        controller.byobRequest.respond(numToWrite);

        if (count >= targetSize) {
          controller.close();
        }
      } else { // enqueue
        console.debug(`enqueuing max(${controller.desiredSize}, ${CHUNK_SIZE}) bytes`);
        const chunkSize = Math.max(controller.desiredSize, CHUNK_SIZE);
        if (targetSize - count > chunkSize) {
          const str = someChars(chunkSize, seed);
          count += str.length;
          controller.enqueue(str);
        } else if (targetSize > count) {
          const str = someChars(targetSize - count, seed);
          count += str.length;
          controller.enqueue(str);
        } else {
          controller.close();
        }
      }
    }
  });
  return stream;
}

const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()';

function someChars (num, seed) {
  let string = charset.charAt(seed % charset.length);

  while (string.length < num) {
    string += ' ' + seed;
  }

  string = string.slice(0, num);
  string[num - 1] = ' ';

  return string;
}
