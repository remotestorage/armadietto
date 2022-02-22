/* eslint-env mocha, chai, node */
const Redis = require('ioredis');
const RedisStore = require('../../lib/stores/redis');
const { itBehavesLike } = require('bdd-lazy-var');
require('../store_spec');

describe('Redis store', () => {
  const store = new RedisStore({ namespace: String(new Date().getTime()) });
  after(async () => {
    const db = new Redis();
    await db.select(0);
    await db.flushdb();
    store._redis.quit();
    db.quit();
  });
  itBehavesLike('Stores', store);
});
