# Armadietto [![npm](https://img.shields.io/npm/v/armadietto)](https://www.npmjs.com/package/armadietto) [![Build Status](https://github.com/remotestorage/armadietto/actions/workflows/test-and-lint.yml/badge.svg)](https://github.com/remotestorage/armadietto/actions/workflows/test-and-lint.yml?query=branch%3Amaster)

> ### :warning: WARNING
> Please do not consider `armadietto` production ready, this project is still
> considered experimental.  As with any alpha-stage storage technology, you
> MUST expect that it will eat your data and take precautions against this. You
> SHOULD expect that its APIs and storage schemas will change before it is
> labelled stable.

## What is this?

Armadietto is a [RemoteStorage](https://remotestorage.io) server written for Node.js.

This is a complete rewrite of [reStore](https://github.com/jcoglan/restore).

## Installation

1. Ensure you have [a maintained version of Node](https://nodejs.org/en/about/releases/) installed.
2. If you will be using Apache as a reverse proxy, ensure it is [version 2.4.49 or later](https://community.remotestorage.io/t/avoid-apache-as-a-basis-for-your-server/139).
3. Run `npm -g i armadietto`


## Usage

See the `notes` directory for configuring a reverse proxy and other recipes.

1. Run `armadietto -e` to see a sample configuration file.
2. Create a configuration file at `/etc/armadietto/conf` (or elsewhere). See below for values and their meanings.
3. Run `armadietto -c /etc/armadietto/conf`

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

The `host` option is optional and specifies the hostname the server will listen
on. Its default value is `0.0.0.0`, meaning it will listen on all interfaces.

The server does not allow users to sign up, out of the box. If you need to allow
that, use the `allow.signup` option:

```js
var server = new Armadietto({
  store: store,
  http:  { host: '127.0.0.1', port: 8000 },
  allow: { signup: true }
});
```

If you navigate to `http://localhost:8000/` you should then see a sign-up link
in the navigation.

## Storage security

In production, we recommend that you restrict access to the files managed by
your armadietto server as much as possible. This is particularly true if you host
your storage on a machine with other web applications; you need to protect your
files in the event that one of those apps is exploited.

You should take these steps to keep your storage safe:

* Pick a unique Unix user to run your server process; no other process on the
  box should run as this user:
  `sudo useradd armadietto --system --no-create-home`

* Do not run other applications as root, or as any user that could access files
  owned by your armadietto user
* Make sure the directory `path/to/storage` cannot be read, written or executed
  by anyone but this user:
  `sudo chmod 0700 /path/to/storage && sudo chown armadietto:armadietto /path/to/storage`

* Do not run armadietto as root; if you need to bind to port 80 or 443 use a
  reverse proxy like nginx, Apache2, caddy, lighttpd or enable bind capability:
  ```setcap 'cap_net_bind_service=+ep' `which armadietto` ```

* Ideally, run your storage inside a container or on a dedicated machine

If you're using the CouchDB or Redis backend, apply similar access restrictions to the
database and to any files containing the database access credentials.

If users are created using CouchDB directly, Armadietto can run without CouchDB admin credentials, reducing your attack surface.

## Serving over HTTPS

Since RemoteStorage is a system for storing arbitrary user-specific data, and
since it makes use of OAuth 2.0, we strongly recommend you serve it over a secure
connection. You can boot the server to listen for HTTP or HTTPS requests or
both.  
If armadietto is behind a reverse proxy on the same machine, the proxy can handle TLS, 
so armadietto only needs to set `enable` and `force` in the https configuration.
The reverse proxy must set the header `x-forwarded-proto` (or `x-forwarded-ssl` or `x-forwarded-scheme`) in the request passed to Armadietto. Armadietto does not yet support the `Forwarded` header.

This configuration boots the app on two ports, one secure and one
plaintext:

```js
const server = new Armadietto({
  store: store,
  http: {
    host: '127.0.0.1',
    port: 8000
  },
  https: {
    force: true,
    host:  '127.0.0.1',
    port:  4343,
    key:   'path/to/ssl.key',
    cert:  'path/to/ssl.crt',
    ca:    'path/to/ca.pem'    // optional
  },
  logging: {
    stdout: ["debug"],
    log_files: ["error"],
    log_dir: "./some-log-dir"
  }

});

server.boot();
```

For example, if you use certificates from [Lets Encrypt](https://letsencrypt.org), you will set
```
    cert: "/etc/letsencrypt/live/domainname/cert.pem",
    key: "/etc/letsencrypt/live/domainname/privkey.pem"
```
where domainname is (usually) the DNS name of your server.

The `force: true` line in the `https` section means the app will:

* Return HTTPS URLs in WebFinger responses
* Force sign-up and OAuth login pages onto an HTTPS connection
* Refuse to process POST authentication requests over insecure connections
* Block insecure storage requests and revoke the client's access

Armadietto considers a request to be secure if:

* armadietto itself acts as an SSL terminator and the connection to it is encrypted
* The `X-Forwarded-SSL` header has the value `on`
* The `X-Forwarded-Proto` header has the value `https`
* The `X-Forwarded-Scheme` header has the value `https`

So you can have an SSL-terminating proxy in front of armadietto as long as it sets
one of those headers, and *does not* let external clients set them. In this
setup, you can set `https.force = true` but omit `https.port`; this means
armadietto itself will not accept encrypted connections but will apply the above
behaviour to enforce secure connections.

## Storage backends

armadietto supports pluggable storage backends, and comes with a file system
implementation and CouchDB out of the box (redis storage backend is on the way in
`feature/redis` branch):

* `Armadietto.FileTree` - Uses the filesystem hierarchy and stores each item in its
  own individual file. Content and metadata are stored in separate files so the
  content does not need base64-encoding and can be hand-edited. Must only be run
  using a single server process.
* `Armadietto.CouchDB` - Uses a CouchDB cluster, storing each user's data in their per-user database.
  * CouchDB can be configured as needed, aside from the following:
    * The CouchDB cluster *must* be configured with **couch_peruser enable**=true.
    * Typically you will also set **delete_dbs**=true.
    * Set **chttpd_auth iterations** (for pbkdf2) to at least 700,000 in 2022, and 100,000 more each year.
    * Set **chttpd_auth timeout** to the number of seconds RS sessions should last.
  * In the systemd unit file for Armadietto, set `Requires=couchdb.service` and `After=couchdb.service`
  * One CouchDB user is created for each RS user. CouchDB users not created by Armadietto would need to have a design document copied over, and Couch permissions set.
  * The RS document size limit is the CouchDB maximum attachment size (1 GiB by default).
  * Each user can store about 300 million documents. (Performance near this limit has not been tested.)
  * Multiple Armadietto instances can access a single CouchDB cluster. In production, Armadietto is typically run on each CouchDB node, and CouchDB is set to only accept requests on port 5984 from localhost.
  * If you replicate from one CouchDB cluster to another, you must ensure users can't write conflicting versions to different clusters. CouchDB conflicts (which are separate from RS conflicts) are resolved by quietly picking a winning revision - effectively discarding some user data. So, RS users should typically be allowed to connect to only one cluster at a time. If replication between two clusters is up-to-date, a user can be switched to using the other cluster. (It is possible to create a “sweep” process outside Armadietto which periodically scans user databases, looks for documents which have CouchDB conflicts, fetches the conflicting revisions, and sends all revisions to users to reconcile. With such a process, users can safely connect to multiple CouchDB clusters.)
  * In production, best practice is to
    * **not** supply CouchDB admin credentials to Armadietto;
    * create users directly in CouchDB, copying over the design document and setting permissions; and
    * run a non-Armadietto process to delete sessions older than the token ("cookie") timeout, using the `sessions` view, with `reduce=false`.

All the backends support the same set of features, including the ability to
store arbitrary binary data with content types and modification times.

They are configured as follows:

```js
// To use the file tree store:
const store = new Armadietto.FileTree({path: 'path/to/storage'});

// Then create the server with your store:
const server = new Armadietto({
  store:  store,
  // ...
});

server.boot();
```

```js
// To use the CouchDB store:
const store = new Armadietto.CouchDB({ url: conf.url, userAdmin: conf.userAdmin, passwordAdmin: conf.passwordAdmin });
const server = new Armadietto({
  store,
  // ...
});

server.boot();
```

## Debugging an installation

Set the environment `DEBUG` to enable logging.  For example `DEBUG=true armadietto -c /etc/armadietto/conf`

## Development

See `DEVELOPMENT.md`

## License

(The MIT License)

Copyright (c) 2012-2015 James Coglan  
Copyright (c) 2018-2022 remoteStorage contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the 'Software'), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
