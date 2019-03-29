const path = require('path');
const Armadietto = require('../lib/armadietto');
let store;
let server;

const type = process.argv[2];

if (type === 'redis') store = new Armadietto.Redis({database: 3});
else store = new Armadietto.FileTree({path: path.join(__dirname, 'tree')});

server = new Armadietto({
  store,
  http: {
    force: true,
    port: 443,
    cert: path.join(__dirname, '/ssl/server.crt'),
    key: path.join(__dirname, '/ssl/server.key')
  },
  allow: {
    signup: true
  },
  cacheViews: false
});

console.log('LISTENING ON PORT 443');
server.boot();
