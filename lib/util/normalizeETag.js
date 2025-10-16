module.exports = function normalizeETag (ETag) {
  if (!ETag) { return ETag; }
  if (!/^("|W\/")/.test(ETag)) { // AWS is careless
    ETag = '"' + ETag;
  }

  if (!/"$/.test(ETag)) {
    ETag += '"';
  }

  return ETag.toLowerCase(); // OpenIO is careless
};
