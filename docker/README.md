# armadietto [![Build Status](https://secure.travis-ci.org/remotestorage/armadietto.svg)](http://travis-ci.org/remotestorage/armadietto) [![js-semistandard-style](https://img.shields.io/badge/code%20style-semistandard-brightgreen.svg?style=flat-square)](https://github.com/Flet/semistandard)

> ### WARNING
> Please do not consider `armadietto` production ready, this project is still
> considered experimental.  As with any alpha-stage storage technology, you
> MUST expect that it will eat your data and take precautions against this. You
> SHOULD expect that its APIs and storage schemas will change before it is
> labelled stable.

## What is this?

Armadietto is a [RemoteStorage](https://remotestorage.io) server written for Node.js.

This is a complete rewrite of [reStore](https://github.com/jcoglan/restore).

It is also available as the
[armadietto](https://www.npmjs.com/package/armadietto) NPM package.

## Usage

```
docker run -d -p 8000:8000 remotestorage/armadietto:latest
```

### Configuration

The default configuration file for armadietto can be found within the docker
container in `/etc/armadietto.conf.json` and contains the following
configuration:

```json
{
  "allow_signup": true,
  "storage_path": "/usr/share/armadietto",
  "cache_views": true,
  "http": {
    "host": "0.0.0.0",
    "port": 8000
  },
  "https": {
    "enable": false,
    "force": false,
    "port": 4443,
    "cert": "/etc/letsencrypt/live/example.com/cert.pem",
    "key": "/etc/letsencrypt/live/example.com/privkey.pem"
  },
  "logging": {
	  "log_dir": "logs",
	  "stdout": ["info"],
	  "log_files": ["error"]
  },
  "basePath": ""
}
```

A custom configuration file can be used by mounting it in the container

```
docker run -d -v /my/custom/armadietto.conf.json:/etc/armadietto.conf.json:ro -p 8000:8000 remotestorage/armadietto:latest
```

A suitable data directory should also be mounted in the container to
ensure data is persisted.

```
docker run -d -v /data/armadietto:/usr/share/armadietto -p 8000:8000 remotestorage/armadietto:latest
```

*Note:* The data and log folders and their contents must be writable and
readable by the container user, which is by default the `armadietto` user
(UID 6582).

### Behind a Proxy

To use armadietto behind a proxy, ensure the `X-Forwarded-Host` and
`X-Forwareded-Proto` headers are passed to armadietto to ensure it uses the
correct address. For more information, see the
[notes](https://github.com/remotestorage/armadietto/tree/master/notes)
folder in the armadietto git repository.

## Development

The armadietto docker image is built using the
[armadietto](https://github.com/remotestorage/armadietto) git repository
and the [`docker/Dockerfile`](https://github.com/remotestorage/armadietto/blob/master/docker/Dockerfile)
[Dockerfile](https://docs.docker.com/engine/reference/builder/). To build
the image yourself, clone the git repository and use the
[`docker build`](https://docs.docker.com/engine/reference/commandline/build/) command.

```
git clone https://github.com/remotestorage/armadietto
cd armadietto
docker build -t remotestorage/armadietto -f docker/Dockerfile .
```

Further information about the development of armadietto can be found in the
[DEVELOPMENT.md](https://github.com/remotestorage/armadietto/blob/master/DEVELOPMENT.md)
file in git repository.
