/* eslint-env mocha, chai */
const chai = require('chai');
const expect = chai.expect;
const normalizeETag = require('../lib/util/normalizeETag');

describe('normalizeETag', () => {
  it('returns the input if it is falsy', () => {
    expect(normalizeETag(null)).to.equal(null);
    expect(normalizeETag(undefined)).to.equal(undefined);
    expect(normalizeETag('')).to.equal('');
  });

  it('preserves already normalized ETags', () => {
    expect(normalizeETag('"abc123"')).to.equal('"abc123"');
    expect(normalizeETag('W/"abc123"')).to.equal('W/"abc123"');
  });

  it('adds quotes to unquoted ETags (AWS case)', () => {
    expect(normalizeETag('abc123')).to.equal('"abc123"');
  });

  it('removes leading quote from weak ETags (AWS SDK/Digital Ocean case)', () => {
    expect(normalizeETag('"W/"abc123"')).to.equal('W/"abc123"');
    expect(normalizeETag('"W/abc123"')).to.equal('W/"abc123"');
  });

  it('adds trailing quote if missing', () => {
    expect(normalizeETag('"abc123')).to.equal('"abc123"');
    expect(normalizeETag('W/"abc123')).to.equal('W/"abc123"');
  });

  it('converts to lowercase, preserving weak/strong distinction (OpenIO case)', () => {
    expect(normalizeETag('"ABC123"')).to.equal('"abc123"');
    expect(normalizeETag('W/"ABC123"')).to.equal('W/"abc123"');
  });

  it('handles combinations of issues', () => {
    expect(normalizeETag('W/ABC123')).to.equal('W/"abc123"');
    expect(normalizeETag('"W/ABC123')).to.equal('W/"abc123"');
    expect(normalizeETag('"W/"ABC123"')).to.equal('W/"abc123"');
  });
});
