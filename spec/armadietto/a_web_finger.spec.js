/* eslint-env mocha, chai, node */

const Armadietto = require('../../lib/armadietto');
const http = require('http');
const { shouldImplementWebFinger } = require('../web_finger.spec');

describe('Web Finger (monolithic)', function () {
  before(function (done) {
    const app = new Armadietto({
      bare: true,
      store: {},
      http: { },
      logging: { stdout: [], log_dir: './test-log', log_files: ['debug'] }
    });
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
