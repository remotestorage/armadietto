module.exports = function normalizeETag (ETag) {
  if (!/^("|W\/")/.test(ETag)) {
    ETag = '"' + ETag;
  }

  if (!/"$/.test(ETag)) {
    ETag += '"';
  }

  return ETag;
};
