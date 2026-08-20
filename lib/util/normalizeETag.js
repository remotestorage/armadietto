module.exports = function normalizeETag (ETag) {
  if (!ETag) { return ETag; }

  if (!/^("|W\/)/.test(ETag)) { // AWS is careless
    ETag = '"' + ETag;
  }
  if (/^"W\//.test(ETag)) { // AWS SDK or Digital Ocean are careless
    ETag = ETag.slice(1);
  }

  if (!/"$/.test(ETag)) {
    ETag += '"';
  }

  return ETag.toLowerCase(); // OpenIO is careless
};
