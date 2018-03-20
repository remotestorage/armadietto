const Armadietto = require('../lib/armadietto');
let store,
  server;

const  type = process.argv[2];

if (type === 'redis')
  store = new Armadietto.Redis({database: 3});
else
  store = new Armadietto.FileTree({path: __dirname + '/tree'});

server = new Armadietto({
  store:  store,
  http:   {port: 8080},
  https:  {
    force:  true,
    port:   443,
    cert:   __dirname + '/ssl/server.crt',
    key:    __dirname + '/ssl/server.key'
  },
  allow: {
    signup: true
  },
  cacheViews: false
});

server.boot();
