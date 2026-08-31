module.exports = function normalizeETag (ETag) {
  if (!ETag) { return ETag; }

  if (!/^("|W\/)/.test(ETag)) { // AWS is careless with quotes
    ETag = '"' + ETag;
  }
  if (/^"W\//.test(ETag)) { // AWS SDK or Digital Ocean are careless with weak ETags
    ETag = ETag.slice(1);
  }
  if (/^W\/[^"]/.test(ETag)) { // AWS SDK or Digital Ocean are careless with weak ETags
    ETag = 'W/"' + ETag.slice(2);
  }

  if (!/"$/.test(ETag)) {
    ETag += '"';
  }

  // OpenIO is careless with casing
  if (ETag.startsWith('W/')) {
    return 'W/' + ETag.slice(2).toLowerCase();
  } else {
    return ETag.toLowerCase();
  }
};
