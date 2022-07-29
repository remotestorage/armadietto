/* eslint-env mocha, chai, node, browser */
/* eslint-disable no-unused-expressions */

const os = require('os');
const chai = require('chai');
const chaiHttp = require('chai-http');
const expect = chai.expect;

const Armadietto = require('../../lib/armadietto');
const rmrf = require('rimraf');

chai.use(chaiHttp);
const port = '5678';
const host = process.env.SERVER_URL || `http://127.0.0.1:${port}`;
const storagePath = os.tmpdir() + '/stress-storage';
const username = process.env.USERNAME || 'stressuser';
const password = process.env.PASSWORD || 'kladljkfdsoi983';
const clientId = 'http://example.com';

const req = chai.request(host);
process.umask(0o077);

describe('Rapid requests', function () {
  this.timeout(300_000);

  before(async function () {
    if (process.env.SERVER_URL) {
      try {
        const url = new URL('/oauth', host).href;

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
        console.info(`    logging in to ${url}: username “${username}” scope “/:rw”`);
        const resp = await fetch(
          url,
          { method: 'POST', body: param }
        );
        if (resp.redirected) {
          const respUrl = new URL(resp.url);
          const respParam = new URLSearchParams(respUrl.hash.slice(1));
          this.token = respParam.get('access_token');
        } else {
          throw new Error(`${host} didn't redirect; ${resp.status} ${resp.statusText} ${(await resp.text()).slice(0, 60)}`);
        }
        console.info(`    using ${username} (CouchDB database ${userDbName(username)})`);
      } catch (err) {
        if (err.constructor !== Error) {
          console.error(`    Is the server running?\n    ${err.name} ${err.code}  ${err.message} -> ${err.cause?.name}  ${err.cause?.code}  ${err.cause?.message}`);
        }
        throw err;
      }
    } else {
      const store = new Armadietto.FileTree({ path: storagePath });

      this.server = new Armadietto({
        store,
        http: { port },
        logging: { log_dir: './stress-log', stdout: [], log_files: ['error'] }
      });
      await this.server.boot();
      await store.createUser({ username, email: 'a@b.co', password });
      await store.authenticate({ username, password });
      this.token = await store.authorize(clientId, username, { '/': ['r', 'w'] });
    }
  });

  after(async function () {
    req.close();
    if (!process.env.SERVER_URL) {
      await this.server.stop();
      await new Promise(function (resolve, reject) {
        rmrf(storagePath, function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
  });

  /* This serves as a performance floor. As long as it passes in GitHub automation, we're okay.
   * On slow machines, the expectations might fail */
  it('serves a burst of many puts and a burst of many gets without error or 429', async function () {
    const directoryName = 'many'; const delayMs = 2;
    const num = 1000; const targetSize = 37;
    const putStatuses = await rapidPuts(this.token, directoryName, delayMs, num, targetSize);

    for (let i = 0; i < num; ++i) {
      // Performance might be slightly different when replacing documents.
      expect(putStatuses[i]).to.be.oneOf([201, 200], `put ${i} failed`);
    }

    const getResults = await rapidGets(this.token, directoryName, delayMs, num);

    for (let i = 0; i < num; ++i) {
      expect(getResults[i].status).to.equal(200, `get ${i} failed`);
      expect(getResults[i].headers.get('content-type')).to.match(/^text\/plain/);
      expect(getResults[i].headers.get('content-length')).to.equal(String(targetSize));

      const text = await getResults[i].text();
      switch (i) {
        case 0:
          expect(text).to.equal('A 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0');
          break;
        case 1:
          expect(text).to.equal('B 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1');
          break;
        case 35:
          expect(text).to.equal('j 35 35 35 35 35 35 35 35 35 35 35 35');
          break;
        default:
          expect(text.length).to.equal(targetSize);
      }
    }
  });

  /* This is a functional test, that the server behaves correctly when overloaded.
   * It must pass on every machine. If no 429s are evoked, increase `num` to make the test harder. */
  it('returns "429 Too Many Requests" or "503 Service Unavailable" when a burst of puts or gets continues too long', async function () {
    const directoryName = 'more'; const delayMs = 1;
    const num = 3000; const targetSize = 5555;
    const putStatuses = await rapidPuts(this.token, directoryName, delayMs, num, targetSize);

    for (let i = 0; i < num; ++i) {
      expect(putStatuses?.[i]).to.be.oneOf([201, 200, 429, 503], `put ${i} failed`);
    }
    const numPutsAccepted = putStatuses.reduce((acc, status) => [201, 200].includes(status) ? acc + 1 : acc, 0);
    expect(numPutsAccepted).to.be.greaterThan(0, 'some puts should be accepted');
    const numPutsRejected = putStatuses.reduce((acc, status) => [429, 503].includes(status) ? acc + 1 : acc, 0);
    expect(numPutsRejected).to.be.greaterThan(0, 'This test did not stress the server enough');

    const repeats = 2;
    const getResults = await rapidGets(this.token, directoryName, delayMs, num, repeats);

    for (let j = 0; j < num * repeats; ++j) {
      const i = j % num;
      if (putStatuses[i] === 201) {
        expect(getResults[j].status).to.be.oneOf([200, 429, 503], `get ${j} (created) failed`);
        expect(getResults[j].headers.get('content-type')).to.match(/^text\/plain/);
      } else {
        expect(getResults[j].status).to.be.oneOf([200, 404, 429, 503], `get ${j} (pre-existing) failed`);
      }
    }

    const getStatuses = getResults.map(result => result?.status);
    const numGetsAccepted = getStatuses.reduce((acc, status) => [200, 404].includes(status) ? acc + 1 : acc, 0);
    expect(numGetsAccepted).to.be.greaterThan(0, 'some gets should be accepted');
    const numGetsRejected = getStatuses.reduce((acc, status) => [429, 503].includes(status) ? acc + 1 : acc, 0);
    expect(numGetsRejected).to.be.greaterThan(0, 'some gets should be rejected');
  });

  /* This serves as a performance floor. As long as it passes in GitHub automation, we're okay.
   * If the expectations fail, the storage on that system is probably too slow for Armadietto. */
  it('handles rapid large puts without error', async function () {
    const directoryName = 'big'; const delayMs = 2;
    const num = 3; const targetSize = 200_000_000;
    const putStatuses = await rapidPuts(this.token, directoryName, delayMs, num, targetSize);

    for (let i = 0; i < num; ++i) {
      // Performance might be slightly different when replacing documents.
      expect(putStatuses[i]).to.be.oneOf([201, 200], `put ${i} failed`);
    }

    const getResults = await rapidGets(this.token, directoryName, delayMs, num);

    for (let i = 0; i < num; ++i) {
      expect(getResults[i].status).to.equal(200, `get ${i} failed`);
      expect(getResults[i].headers.get('content-type')).to.match(/^text\/plain/);
      expect(getResults[i].headers.get('content-length')).to.equal(String(targetSize));
    }
  });
});

function userDbName (username) {
  return 'userdb-' + Buffer.from(username).toString('hex');
}

async function rapidPuts (token, directoryName, delayMs, num, targetSize = 32) {
  const puts = [];
  for (let i = 0; i < num; ++i) {
    const path = `/storage/${username}/${directoryName}/${i}`;
    puts.push(fetch(new URL(path, host), {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'text/plain' },
      body: streamFactory(targetSize, i)
    }
    ));
    await delay(delayMs);
  }
  try {
    const putResults = await Promise.all(puts);
    return putResults?.map(result => result?.status);
  } catch (err) {
    let msg = `    while awaiting put of small document\n    ${err.name}  ${err.code}  ${err.message}`;
    if (err.cause) {
      msg += ` -> ${err.cause?.name}  ${err.cause?.code}  ${err.cause?.message}`;
    }
    console.error(msg);
    throw err.cause || err;
  }
}

async function rapidGets (token, directoryName, delayMs, num, repeats = 1) {
  const gets = [];
  // Reads are faster, so let's do more of them.
  for (let j = 0; j < num * repeats; ++j) {
    const i = j % num;
    const path = `/storage/${username}/${directoryName}/${i}`;
    gets.push(fetch(
      new URL(path, host),
      { headers: { Authorization: 'Bearer ' + token } }
    ));
    await delay(delayMs);
  }
  return await Promise.all(gets);
}

const CHUNK_SIZE = 1024;
const encoder = new TextEncoder();

function streamFactory (targetSize, seed = 1) {
  let count = 0;

  const stream = new ReadableStream({
    type: 'bytes',
    autoAllocateChunkSize: CHUNK_SIZE,
    pull (controller) {
      if (controller.byobRequest) {
        const numRemaining = targetSize - count;
        const view = controller.byobRequest.view; // Uint8Array(256)
        const numToWrite = Math.min(view.length, numRemaining);

        encoder.encodeInto(someChars(numToWrite, seed), view);
        count += numToWrite;
        controller.byobRequest.respond(numToWrite);

        if (count >= targetSize) {
          controller.close();
        }
      } else {
        console.log('byobRequest was null');
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

function delay (ms) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}
