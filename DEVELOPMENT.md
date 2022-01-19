# Development for Armadietto

## Setup

1. [Generate an SSH key pair](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent) (if you don't already have one). It must be RSA or, preferably, ed25519.
2. Add the *public* key [to your GitHub account](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/adding-a-new-ssh-key-to-your-github-account).
3. Run `git clone https://github.com/remotestorage/armadietto.git` to pull the code.
4. Run `yarn install` or `npm install`. to install the dependencies.

## Development

* Run `npm test` to run the automated tests. 
* Run `npm run dev` to start a server on your local machine, and have it automatically restart when you update a source code file in `/lib`.

Set the environment `DEBUG` to enable logging.

Add automated tests for any new functionality. For bug fixes, start by writing an automated test that fails under the buggy code, but will pass when you've written a fix. Using TDD is not required, but will help you write better code.

Before committing, run `npm lint:fix` and `npm test`. Fix any tests that fail.
