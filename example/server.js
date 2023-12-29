const path = require('path');
const Armadietto = require('../lib/armadietto');
let store;

const type = process.argv[2];

if (type === 'redis') store = new Armadietto.Redis({ database: 3 });
else store = new Armadietto.FileTree({ path: path.join(__dirname, 'tree') });

const server = new Armadietto({
  store,
  http: {
    port: 8000
  },
  allow: {
    signup: true
  },
  cacheViews: false
});

console.log('LISTENING ON PORT 8000');
server.boot();
