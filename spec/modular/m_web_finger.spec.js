/* eslint-env mocha, chai, node */

const app = require('../../lib/app');
const http = require('http');
const { configureLogger } = require('../../lib/logger');
const { shouldImplementWebFinger } = require('../web_finger.spec');

describe('Web Finger (modular)', function () {
  before(function (done) {
    configureLogger({ log_dir: './test-log', stdout: [], log_files: ['debug'] });

    app.locals.title = 'Test Armadietto';
    app.locals.basePath = '';
    app.locals.host = 'localhost:xxxx';
    app.locals.signup = false;
    this.server = http.createServer(app);
    this.server.listen();
    this.server.on('listening', () => {
      this.port = this.server.address().port;
      this.host = this.server.address().address + ':' + this.server.address().port;
      done();
    });
  });

  after(function (done) {
    this.server.close(done);
  });

  shouldImplementWebFinger();
});
