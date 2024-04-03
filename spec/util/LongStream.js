const { Readable } = require('node:stream');

module.exports = class LongStream extends Readable {
  limit;
  total = 0;

  constructor (limit, options) {
    super(options);
    this.limit = limit;
  }

  _read (size) {
    let line = '....................................................................................................';
    this.total += 100;
    const numberStr = this.total.toLocaleString();
    line = line.slice(0, -numberStr.length) + numberStr;
    // if (this.total % 1_000_000 === 0) { console.log(line); }
    this.push(line, 'utf8');
    if (this.total >= this.limit) {
      this.push(null);
      console.log(`BigStream complete; ${this.total.toLocaleString()} bytes were read.`);
    }
  }
};
