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

## Containerized Installation, Usage & Development

See [the Docker README](./docker/README.md)

## Installation (non-containerized)

1. Ensure you have [a maintained version of Node](https://nodejs.org/en/about/releases/) installed.
2. If you will be using Apache as a reverse proxy, ensure it is [version 2.4.49 or later](https://community.remotestorage.io/t/avoid-apache-as-a-basis-for-your-server/139).
3. Run `npm -g i armadietto`


## Usage

See the `notes` directory for configuring a reverse proxy and other recipes.

### Modular (new) Server

* Streaming storage (documents don't have to fit in server memory)
* S3-compatible storage (requires separate S3 server; AWS S3 allows documents up to 5 TB)
* Can run multiple application servers to increase capacity to enterprise-scale
* Bug Fix: correctly handles If-None-Match with ETag
* Bug Fix: returns empty listing for nonexistent folder
* Implements current spec: draft-dejong-remotestorage-22

See [the modular-server-specific documentation](./notes/modular-server.md) for usage.

### Monolithic (old) Server

* Stores user documents in server file system
* More thoroughly tested
* Implements older spec: draft-dejong-remotestorage-01

See [the monolithic-server-specific documentation](./notes/monolithic-server.md) for usage.

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

If you're using the Redis backend, apply similar access restrictions to the
database and to any files containing the database access credentials.

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


## Debugging an installation

Set the environment `DEBUG` to enable logging.  For example `DEBUG=true armadietto -c /etc/armadietto/conf.json`

## Development

See `DEVELOPMENT.md`

## License

(The MIT License)

Copyright © 2012–2015 James Coglan
Copyright © 2018–2025 remoteStorage contributors

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
