// var FileTree = require("../../lib/stores/file_tree"),
//     rmrf     = require("rimraf"),
//     JS       = require("jstest")

// JS.Test.describe("FileTree store", function() { with(this) {
//   before(function() { with(this) {
//     stub(require("../../lib/stores/core"), "hashRounds", 1)
//     this.store = new FileTree({path: __dirname + "/../../tmp/store"})
//   }})

//   after(function(resume) { with(this) {
//     rmrf(__dirname + "/../../tmp", resume)
//   }})

//   itShouldBehaveLike("storage backend")
// }})

/* eslint-env mocha, chai, node */
const path = require('path');
const rmrf = require('rimraf');
const FileTree = require('../../lib/stores/file_tree');
const { itBehavesLike } = require('bdd-lazy-var');
require('../store_spec');

// let store;

describe('FileTree store', () => {
  let store = new FileTree({path: path.join(__dirname, '/../../tmp/store')});
  afterEach(() => {
    rmrf(path.join(__dirname, '/../../tmp/store'), () => {});
  });
  itBehavesLike('Stores', store);
});
