#!/usr/bin/env node
const Armadietto = require('../lib/armadietto');
const path = require('path');
const fs = require('fs');

const remoteStorageServer = {

  // reads and return configuration file
  readConf (confPath) {
    return JSON.parse(fs.readFileSync(confPath, 'utf8'));
  },

  // parses cli args
  parseArgs () {
    const ArgumentParser = require('argparse').ArgumentParser;
    const version = require(path.join(__dirname, '/../package.json')).version;
    const parser = new ArgumentParser({
      add_help: true,
      description: 'NodeJS remoteStorage server / ' + version
    });

    parser.add_argument('-c', '--conf', {
      help: 'Path to configuration'
    });

    parser.add_argument('-e', '--exampleConf', {
      help: 'Print configuration example',
      action: 'store_true'
    });

    return parser.parse_args();
  },

  init () {
    const args = this.parseArgs();
    let conf = {};

    if (args.exampleConf) {
      console.log(fs.readFileSync(path.join(__dirname, '/conf-couchdb.json'), 'utf8'));
      return -1;
    }

    if (!args.conf) {
      console.error('[ERR] Configuration file needed (help with -h)');
      return -1;
    }

    try {
      conf = this.readConf(args.conf);
    } catch (e) {
      console.error(e.toString());
      return -1;
    }

    process.umask(0o077);
    const store = new Armadietto.CouchDB({ url: conf.url, userAdmin: conf.userAdmin, passwordAdmin: conf.passwordAdmin });
    const server = new Armadietto({
      basePath: conf.basePath,
      store,
      logging: conf.logging,
      http: {
        host: conf.http.host,
        port: conf.http.port
      },
      https: conf.https
        ? {
            host: conf.https.host,
            port: conf.https.enable && conf.https.port,
            force: conf.https.force,
            cert: conf.https.cert,
            key: conf.https.key
          }
        : {},
      allow: {
        signup: conf.allow_signup || false
      },
      cacheViews: conf.cache_views || false
    });

    server.boot();
  }
};

if (require.main === module) {
  remoteStorageServer.init();
}
