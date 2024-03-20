module.exports = function (total, increment = 100) {
  let string = ''; let num;
  for (num = increment; num <= total; num += increment) {
    const numberStr = String(num);
    let line = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    line = line.slice(0, -numberStr.length) + numberStr;
    string += line;
  }
  return string;
};
