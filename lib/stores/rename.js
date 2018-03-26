'use strict';

const fs    = require('fs'),
      path  = require('path');

var rename = function(pathname, pattern, replacement, callback) {
  var dirname  = path.dirname(pathname),
      basename = path.basename(pathname),
      newName  = basename.replace(pattern, replacement);

  if (newName !== basename) {
    fs.rename(pathname, path.join(dirname, newName), callback);
    // console.log(pathname, '---->', path.join(dirname, newName));
  } else {
    callback();
  }
};

var traverse = function(pathname, root, pattern, replacement, callback) {
  fs.stat(pathname, function(error, stat) {
    if (error) return callback(error);
    if (stat.isFile()) return rename(pathname, pattern, replacement, callback);
    if (!stat.isDirectory()) return callback(new Error());

    fs.readdir(pathname, (error, entries) => {
      Promise.all(entries.map((entry) => {
        return new Promise((resolve, reject) => {
          traverse(path.join(pathname, entry), false, pattern, replacement, resolve);
        });
      })).then((error) => {
        if (error) return callback(error);
        if (root) return callback();
        rename(pathname, pattern, replacement, callback);
      });
    });
  });
};

var batchRename = async function(pathname, renames, callback) {
  for (let pair of renames) {
    await new Promise((resolve) => {
      traverse(pathname, true, pair[0], pair[1], resolve);
    });
  }
  callback();
};

module.exports = batchRename;
