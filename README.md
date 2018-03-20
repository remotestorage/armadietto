# armadietto [![Build Status](https://secure.travis-ci.org/remotestorage/armadietto.svg)](http://travis-ci.org/remotestorage/armadietto)

## What is this?

armadietto is a [RemoteStorage][1] server written for Node.js.

This is a fork of [reStore](https://github.com/jcoglan/restore). The
original author, James Coglan, stopped development of the project. This fork
contains critical bugfixes, and will persist as an independent project until
maintenance of restore resumes.

[1]: http://www.w3.org/community/unhosted/wiki/RemoteStorage

### CAVEAT EMPTOR

This project is still considered experimental. It has not been widely deployed,
and I am in the process of rolling it out for personal use and within my
company.

As with any alpha-stage storage technology, you MUST expect that it will eat
your data and take precautions against this. You SHOULD expect that its APIs and
storage schemas will change before it is labelled stable. I MAY respond to bug
reports but you MUST NOT expect that I will.

Per the MIT license, **usage is entirely at your own risk**.



## Installation

```
$ git clone https://github.com/remotestorage/armadietto
$ cd armadietto
$ npm install
```


## Usage

The following Node script will run a basic server:

```js
process.umask(077);

var armadietto = require('armadietto'),
    store   = new armadietto.FileTree({path: 'path/to/storage'}),
    
    server  = new armadietto({
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
var server = new armadietto({
               store: store,
               http:  {host: '127.0.0.1', port: 8000},
               allow: {signup: true}
             });
```

If you navigate to `http://localhost:8000/` you should then see a sign-up link
in the navigation.


### Storage security

In production, we recommend that you restrict access to the files managed by
your armadietto server as much as possible. This is particularly true if you host
your storage on a machine with other web applications; you need to protect your
files in the event that one of those apps is exploited.

You should take these steps to keep your storage safe:

* Pick a unique Unix user to run your server process; no other process on the
  box should run as this user
* Do not run other applications as root, or as any user that could access files
  owned by your armadietto user
* Use `process.umask(077)` as shown above so that the server creates files that
  can only be accessed by the process's owner
* Make sure the directory `path/to/storage` cannot be read, written or executed
  by anyone but this user
* Do not run armadietto as root; if you need to bind to port 80 or 443 use a
  reverse proxy like Apache or nginx
* Ideally, run your storage inside a container or on a dedicated machine

If you're using the Redis backend, apply similar access restrictions to the
database and to any files containing the database access credentials.


### Serving over HTTPS

Since RemoteStorage is a system for storing arbitrary user-specific data, and
since it makes use of OAuth 2.0, we recommend you serve it over a secure
connection. You can boot the server to listen for HTTP or HTTPS requests or
both. This configuration boots the app on two ports, one secure and one
plaintext:

```js
var server = new armadietto({
  store:  store,
  http:   {
    host: '127.0.0.1',
    port: 8000
  },
  https:  {
    force:  true,
    host:   '127.0.0.1',
    port:   4343,
    key:    'path/to/ssl.key',
    cert:   'path/to/ssl.crt',
    ca:     'path/to/ca.pem'    // optional
  }
});

server.boot();
```

Note that you should not run armadietto as root. To make it available via port 80
or 443, use Apache, nginx or another reverse proxy.

The `force: true` line in the `https` section means the app will:

* Return HTTPS URLs in WebFinger responses
* Force sign-up and OAuth login pages onto an HTTPS connection
* Refuse to process POST authentication requests over insecure connections
* Block insecure storage requests and revoke the client's access

armadietto considers a request to be secure if:

* armadietto itself acts as an SSL terminator and the connection to it is
  encrypted
* The `X-Forwarded-SSL` header has the value `on`
* The `X-Forwarded-Proto` header has the value `https`
* The `X-Forwarded-Scheme` header has the value `https`

So you can have an SSL-terminating proxy in front of armadietto as long as it sets
one of those headers, and *does not* let external clients set them. In this
setup, you can set `https.force = true` but omit `https.port`; this means
armadietto itself will not accept encrypted connections but will apply the above
behaviour to enforce secure connections.


### Storage backends
