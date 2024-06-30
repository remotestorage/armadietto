const { readdir, stat } = require('node:fs/promises');
const path = require('path');

module.exports = async function mostRecentFile (dirPath) {
  const fileNames = await readdir(dirPath);
  const records = [];
  for (const fileName of fileNames) {
    const stats = await stat(path.join(dirPath, fileName));
    records.push({ fileName, ctime: stats.ctime });
  }
  records.sort((a, b) => b.ctime - a.ctime);
  return records[0].fileName;
};
