# Development for Armadietto

## Setup

1. Run `git clone https://github.com/remotestorage/armadietto.git` to pull the code.
2. Run `npm install` to install the dependencies.
3. Register for S3-compatible storage with your hosting provider, install [a self-hosted implementation](notes/S3-store-router.md), or use the public account on `play.min.io` (which is slow, and to which anyone in the world can read and write!).

## Development

* Run `npm test` to run the automated tests for both monolithic and modular servers (except the tests for S3 store router).
* If you don't have an S3-compatible server configured, run `npm test-s3-wo-configured-server`
* Set the S3 environment variables and run Mocha with `./node_modules/mocha/bin/mocha.js -u bdd-lazy-var/getter spec/armadietto/storage_spec.js` to test the S3 store router using your configured S3 server. (If the S3 environment variables aren't set, the S3 router uses the shared public account on play.min.io.) If any tests fail on one S3 implementation but not others, add a note to [the S3 notes](notes/S3-store-router.md)
* Run `npm run modular` to start a modular server on your local machine, and have it automatically restart when you update a source code file in `/lib`.
* Run `npm run dev` to start a monolithic server on your local machine, and have it automatically restart when you update a source code file in `/lib`.

Set the environment `DEBUG` to enable verbose logging of HTTP requests. For the modular server, these are the requests to the S3 server. For the monolithic server, these are the requests to Armadietto.

Add automated tests for any new functionality. For bug fixes, start by writing an automated test that fails under the buggy code, but will pass when you've written a fix. Using TDD is not required, but will help you write better code.

Before committing, run `npm lint:fix` and `npm test`. Fix any tests that fail.
