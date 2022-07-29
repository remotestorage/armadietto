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

function userDbName (username) {
  return 'userdb-' + Buffer.from(username).toString('hex');
}

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
          console.error(`    Is the server running?\n    ${err.name}  ${err.message} -> ${err.cause?.name}  ${err.cause?.message}`);
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
    const delayMs = 2; const num = 1000;
    const puts = []; const gets = [];
    for (let i = 0; i < num; ++i) {
      const data = 'ABC' + String(1000 + i);
      const path = `/storage/${username}/many/${i}`;
      // Chai+Superagent doesn't send right away, unless you call end().
      puts.push(new Promise((resolve, reject) => {
        req.put(path).set('Authorization', 'Bearer ' + this.token).type('text/plain').send(Buffer.from(data)).end((err, resp) => {
          if (err) { reject(err); } else { resolve(resp); }
        });
      }));
      await delay(delayMs);
    }
    const putResults = await Promise.all(puts);

    for (let i = 0; i < num; ++i) {
      // Performance might be slightly different when replacing documents.
      expect(putResults[i].statusCode).to.be.oneOf([201, 200], `request ${i} failed`);
    }

    for (let i = 0; i < num; ++i) {
      const path = `/storage/${username}/many/${i}`;
      // Chai+Superagent doesn't send right away, unless you call end().
      gets.push(new Promise((resolve, reject) => {
        req.get(path).set('Authorization', 'Bearer ' + this.token).end((err, resp) => {
          if (err) { reject(err); } else { resolve(resp); }
        });
      }));
      await delay(delayMs);
    }
    const getResults = await Promise.all(gets);

    for (let i = 0; i < num; ++i) {
      expect(getResults[i].statusCode).to.equal(200);
      expect(getResults[i]).to.be.text;
      expect(getResults[i].text).to.equal('ABC' + String(1000 + i));
    }
  });

  /* This is a functional test, that the server behaves correctly when overloaded.
   * It must pass on every machine. If no 429s are returned, increase `num` to make the test harder. */
  it('returns "429 Too Many Requests" when a burst of puts or gets continues too long', async function () {
    const delayMs = 1; const num = 3000;
    const puts = []; const gets = [];
    for (let i = 0; i < num; ++i) {
      const data = 'ABC' + String(1000 + i);
      const path = `/storage/${username}/more/${i}`;
      // Chai+Superagent doesn't send right away, unless you call end().
      puts.push(new Promise((resolve, reject) => {
        req.put(path).set('Authorization', 'Bearer ' + this.token).type('text/plain').send(Buffer.from(data)).end((err, resp) => {
          if (err) { reject(err); } else { resolve(resp); }
        });
      }));
      await delay(delayMs);
    }
    const putResults = await Promise.all(puts);

    const putStatusCodes = putResults.map(result => result.statusCode);
    for (let i = 0; i < num; ++i) {
      expect(putStatusCodes[i]).to.be.oneOf([201, 200, 429]);
    }
    expect(putStatusCodes).to.include(201);
    expect(putStatusCodes).to.include(429);

    // reads are faster, so let's do twice as many
    for (let j = 0; j < num * 2; ++j) {
      const i = j % num;
      const path = `/storage/${username}/more/${i}`;
      // Chai+Superagent doesn't send right away, unless you call end().
      gets.push(new Promise((resolve, reject) => {
        req.get(path).set('Authorization', 'Bearer ' + this.token).end((err, resp) => {
          if (err) { reject(err); } else { resolve(resp); }
        });
      }));
      await delay(delayMs);
    }
    const getResults = await Promise.all(gets);

    for (let j = 0; j < num * 2; ++j) {
      const i = j % num;
      if (putResults[i].statusCode === 201) {
        expect(getResults[j].statusCode).to.be.oneOf([200, 429]);
        expect(getResults[j]).to.be.text;
      } else {
        expect(getResults[j].statusCode).to.be.oneOf([200, 404, 429]);
      }
    }

    const getStatusCodes = getResults.map(result => result.statusCode);
    expect(getStatusCodes).to.include(200);
    expect(getStatusCodes).to.include(404);
    expect(getStatusCodes).to.include(429);
  });

  /* This serves as a performance floor. As long as it passes in GitHub automation, we're okay.
   * If the expectations fail, the storage on that system is probably too slow for Armadietto. */
  it('handles rapid large puts without error', async function () {
    const article1 = 'All human beings are born free and equal in dignity and rights. They are endowed with reason and conscience and should act towards one another in a spirit of brotherhood.';

    const article2 = 'Everyone is entitled to all the rights and freedoms set forth in this Declaration, without distinction of any kind, such as race, colour, sex, language, religion, political or other opinion, national or social origin, property, birth or other status. Furthermore, no distinction shall be made on the basis of the political, jurisdictional or international status of the country or territory to which a person belongs, whether it be independent, trust, non-self-governing or under any other limitation of sovereignty.';

    const path1 = `/storage/${username}/big/1`;
    const request1 = req.put(path1).set('Authorization', 'Bearer ' + this.token).type('text/plain');
    for (let i = 0; i < 200_000_000 / article1.length; ++i) {
      request1.send(article1);
    }

    const path2 = `/storage/${username}/big/2`;
    const request2 = req.put(path2).set('Authorization', 'Bearer ' + this.token).type('text/plain');
    for (let i = 0; i < 200_000_000 / article2.length; ++i) {
      request2.send(article2);
    }

    const promise1 = new Promise((resolve, reject) => {
      request1.end((err, resp) => {
        if (err) { reject(err); } else { resolve(resp); }
      });
    });
    const promise2 = new Promise((resolve, reject) => {
      request2.end((err, resp) => {
        if (err) { reject(err); } else { resolve(resp); }
      });
    });
    const response1 = await promise1;
    // Performance might be slightly different when replacing documents.
    expect(response1.statusCode).to.be.oneOf([201, 200]);

    const response2 = await promise2;
    expect(response2.statusCode).to.be.oneOf([201, 200]);
  });
});

function delay (ms) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}