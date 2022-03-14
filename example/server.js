const path = require('path');
const Armadietto = require('../lib/armadietto');
let store;

const type = process.argv[2];

if (type === 'redis') store = new Armadietto.Redis({ database: 3 });
else store = new Armadietto.FileTree({ path: path.join(__dirname, 'tree') });
const middleware = [ // order matters:  on each request middleware called in order defined below
  require('../lib/extensions/storage_allowance/storage_allowance'),
];
const server = new Armadietto({
  store,
  middleware,
  http: {
    port: 8000
  },
  allow: {
    signup: true
  },
  cacheViews: false,
  "extensions": {
    "storage_allowance": {
      "enabled": true,
      "max_bytes": 10485760,
      "salt": "c0c0nut"
    }
  }
});

console.log('LISTENING ON PORT 8000');
server.boot();
