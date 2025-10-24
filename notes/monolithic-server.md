# Monolithic (old) Server

[Docker image](https://hub.docker.com/r/remotestorage/armadietto-monolithic)

## Use

1. Run `armadietto -e` to see a sample configuration file.
2. Create a configuration file at `/etc/armadietto/conf.json` (or elsewhere). See below for values and their meanings.
3. Run `armadietto -c /etc/armadietto/conf.json`

To see all options, run `armadietto -h`. Set the environment `DEBUG` to log the headers of every request.

## Use as a library

The following Node script will run a basic server:
```js
process.umask(077);

const Armadietto = require('armadietto');
store   = new Armadietto.FileTree({path: 'path/to/storage'}),
server  = new Armadietto({
  store:  store,
  http:   {host: '127.0.0.1', port: 8000}
});
server.boot();
```

The `host` option is optional and specifies the hostname the server will listen on. Its default value is `0.0.0.0`, meaning it will listen on all interfaces.

The server does not allow users to sign up, out of the box. If you need to allow that, use the `allow_signup` option:
```js

var server = new Armadietto({
  store: store,
  http:  { host: '127.0.0.1', port: 8000 },
  allow_signup: true
});
```

If you navigate to `http://localhost:8000/` you should then see a sign-up link in the navigation.

## Storage backends

Armadietto supports pluggable storage backends, and comes with a file system
implementation out of the box (redis storage backend is on the way in
`feature/redis` branch):

* `Armadietto.FileTree` - Uses the filesystem hierarchy and stores each item in its
  own individual file. Content and metadata are stored in separate files so the
  content does not need base64-encoding and can be hand-edited. Must only be run
  using a single server process.

All the backends support the same set of features, including the ability to
store arbitrary binary data with content types and modification times.

They are configured as follows:

```js
// To use the file tree store:
const store = new Armadietto.FileTree({path: 'path/to/storage'});

// Then create the server with your store:
const server = new Armadietto({
  store:  store,
  http:   {port: process.argv[2]}
});

server.boot();
```

## Lock file contention

The data-access locking mechanism is lock-file based.
You may need to tune the lock-file timeouts in your configuration:
- *lock_timeout_ms* - millis to wait for lock file to be available
- *lock_stale_after_ms* - millis to wait to deem lockfile stale

To tune, run the [hosted RS load test](https://overhide.github.io/armadietto/example/load.html) or follow instructions in [example/README.md](example/README.md) for local setup and subsequently run [example/load.html](example/load.html) off of `npm run serve` therein.
