/* eslint-env mocha, chai, node */
const path = require('path');
const rmrf = require('rimraf');
const FileTree = require('../../lib/stores/file_tree');
const { itBehavesLike } = require('bdd-lazy-var');
require('../store_spec');

describe('FileTree store', () => {
  const store = new FileTree({ path: path.join(__dirname, '/../../tmp/store') });
  after(() => {
    rmrf(path.join(__dirname, '/../../tmp/store'), () => {});
  });
  itBehavesLike('Stores', store);
});
