# Development for Armadietto

## Setup

1. Run `git clone https://github.com/remotestorage/armadietto.git` to pull the code.
2. Run `yarn install` or `npm install`. to install the dependencies.

## Development

* Run `npm test` to run the automated tests. 
* Run `npm run dev` to start a server on your local machine, and have it automatically restart when you update a source code file in `/lib`.

Set the environment `DEBUG` to enable verbose logging of HTTP requests.

Add automated tests for any new functionality. For bug fixes, start by writing an automated test that fails under the buggy code, but will pass when you've written a fix. Using TDD is not required, but will help you write better code.

Before committing, run `npm lint:fix` and `npm test`. Fix any tests that fail.
