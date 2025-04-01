# Armadietto [![Build Status](https://secure.travis-ci.org/remotestorage/armadietto.svg)](http://travis-ci.org/remotestorage/armadietto) [![js-semistandard-style](https://img.shields.io/badge/code%20style-semistandard-brightgreen.svg?style=flat-square)](https://github.com/Flet/semistandard)

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

## Usage of containerized Armadietto

You may need to preface the `docker run` commands below with `sudo`, depending on how Docker is installed on your host machine.

### Quick test

For a quick test server, run

```shell
docker run -d -p 8000:8000 remotestorage/armadietto-monolithic:latest
```
It will serve over HTTP only on port 8000.
User data will be discarded when the container exits.

### Environment variables

On the host, create the file `.env.local` in your working directory, and set environment variables for the container in there.

### Configuration

Create a directory on the host where configuration files will be read from.
Copy either `docker/conf-container-modular.json` or `docker/conf-container-monolithic.json` as appropriate to the config directory and name it `conf.json`.
Edit it with values for your server.
Don't change the values of `storage_path`, `https.cert` or `https.key`.

See [modular-server.md](../notes/modular-server.md) or [monolithic-server.md](../notes/monolithic-server.md) for config file values and environment variables to set in `.env.local`

If Armadietto is handling TLS (SSL) itself, copy the certificate and key files to `cert.pem` and `privkey.pem` in the config directory.

*Note:* The data and log folders and their contents must be writable and
readable by the container user, which is by default the `armadietto` user
(UID 6582).

### General usage

Below, replace `/absolute/path/to/config/dir` with the absolute path to the host directory where config files are stored.
Replace `/absolute/path/to/logs` with the absolute path to a host directory where log files will be written.

#### Modular server

```shell
docker run -d --restart always -p 80:8000 -p 443:4443 --env-file .env.local -v /absolute/path/to/config/dir:/etc/armadietto:ro -v /absolute/path/to/logs:/opt/armadietto/logs remotestorage/armadietto-modular:latest
```
* Omit `-p 443:4443` if Armaditto is not handling TLS (SSL) itself.
* Insert `--name armadietto` if you need to distinguish Armadietto from other containers.

If you don't set the [S3 environment variables](../notes/modular-server.md#use) in `.env.local` (see below), the S3 router will use the public account on `play.min.io`, where the documents & folders can be **read, altered and deleted** by anyone in the world! Also, the Min.IO browser can't list your documents or folders.

You'll need to set [`BOOTSTRAP_OWNER`](../notes/modular-server.md#use) in `.env.local` to create an invitation for the owner account.  After the account is set up, you can delete `BOOTSTRAP_OWNER` if you like.

#### Monolithic server
Replace `/absolute/path/to/data` with the path to a directory where user data will be stored, so it will persist when the container is restarted.
```shell
docker run -d --restart always -p 80:8000 -p 443:4443 -v /absolute/path/to/data:/usr/share/armadietto -v /absolute/path/to/config/dir:/etc/armadietto:ro -v /absolute/path/to/logs:/opt/armadietto/logs remotestorage/armadietto-monolithic:latest
```
* Insert `--env-file .env.local` if you need to set environment variables.
* Omit `-p 443:4443` if Armaditto is not handling TLS (SSL) itself.
* Insert `--name armadietto` if you need to distinguish Armadietto from other containers.

### Behind a Proxy

To use armadietto behind a proxy, ensure the `X-Forwarded-Host` and
`X-Forwareded-Proto` headers are passed to armadietto to ensure it uses the
correct address. For more information, see the
[notes](../notes)
folder in the armadietto git repository.

### Restarting on reboot

After the host is rebooted, when the docker daemon is started, it will restart the container.
You might need to configure the docker daemon to restart when the host reboots.

## Development

The armadietto docker image is built using the
[armadietto](https://github.com/remotestorage/armadietto) git repository
and the [`docker/Dockerfile-modular`](./Dockerfile-modular) or [`docker/Dockerfile-monolithic`](./Dockerfile-monolithic)
[Dockerfile](https://docs.docker.com/engine/reference/builder/). To build
the image yourself, clone the git repository and use the
[`docker build`](https://docs.docker.com/engine/reference/commandline/build/) command:

```shell
git clone https://github.com/remotestorage/armadietto
cd armadietto
```
then
```shell
docker build -t remotestorage/armadietto-modular -f docker/Dockerfile-modular .
```
or
```shell
docker build -t remotestorage/armadietto-monolithic -f docker/Dockerfile-monolithic .
```

Further information about the development of armadietto can be found in the
[DEVELOPMENT.md](../DEVELOPMENT.md)
file in git repository.
