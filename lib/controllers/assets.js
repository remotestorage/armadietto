const path = require('path');
const Controller = require('./base');
const assetDir = path.join(__dirname, '..', 'assets');

const TYPES = {
  '.css': 'text/css; charset=utf8',
  '.js': 'application/javascript; charset=utf8',
  '.svg': 'image/svg+xml; charset=utf8'
};

class Assets extends Controller {
  serve (filename) {
    const content = this.readFile(path.join(assetDir, filename));
    const type = TYPES[path.extname(filename)];

    if (content) {
      this.response.writeHead(200, {
        'Content-Length': content.length,
        'Content-Type': type
      });
      this.response.end(content);
    } else {
      this.errorPage(404, 'Not found');
    }
  }
}

module.exports = Assets;
