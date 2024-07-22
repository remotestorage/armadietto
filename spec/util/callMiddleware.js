const { Readable } = require('node:stream');
const httpMocks = require('node-mocks-http');
const chai = require('chai');
const errToMessages = require('../../lib/util/errToMessages');

module.exports = async function callMiddleware (middleware, reqOpts) {
  const req = Object.assign(reqOpts.body instanceof Readable
    ? reqOpts.body
    : Readable.from([reqOpts.body], { objectMode: false }), reqOpts);
  req.originalUrl ||= req.url;
  req.baseUrl ||= req.url;
  req.headers = {};
  for (const [key, value] of Object.entries(reqOpts.headers || {})) {
    req.headers[key.toLowerCase()] = String(value);
  }
  req.get = headerName => req.headers[headerName?.toLowerCase()];
  req.query ||= {};
  req.files ||= {};
  req.socket ||= {};
  req.ips = [req.ip = '127.0.0.1'];
  req.session ||= {};

  const res = httpMocks.createResponse({ req });
  res.req = req;
  req.res = res;
  res.logNotes = new Set();
  const next = chai.spy(err => {
    if (err) {
      let status;
      if (err.Code === 'SlowDown') {
        status = err.$metadata?.httpStatusCode;
      }
      if (!status) {
        status = Array.from(errToMessages(err, new Set())).join(' ') + (err?.stack ? '|' + err.stack : '');
      }
      res.status(status).end();
    } else {
      res.end();
    }
  });

  await middleware(req, res, next);
  await waitForEnd(res);

  return [req, res, next];
};

async function waitForEnd (response) {
  return new Promise(resolve => {
    setTimeout(checkEnd, 100);
    function checkEnd () {
      if (response._isEndCalled()) {
        resolve();
      } else {
        setTimeout(checkEnd, 100);
      }
    }
  });
}
