// logging.js
//
// Helper code to allow click through from login.html and service.html to show their respective source code.

var isScreenSetup = false;
var logsPostScreenSetup = [];

function log(message, params, fileName) {
  fileName = fileName || 'index.html';
  var prefix = `[${(new Date()).toLocaleTimeString()}] (${fileName}) :: `;
  var msg = params ? prefix + message + " : {\n" + fixupParamsOutput(prefix.length, JSON.stringify(params, null, 2)) + "\n" : prefix + message + "\n";
  msg = "<pre class='clickable' onclick='setCodeToMessage(\"" + fileName + "\",\"" + message + "\")'>" + msg + "</pre>";

  if (isScreenSetup) {
    $('#logviewcontents').append(msg);
    $("#logview").scrollTop($("#logviewcontents").height());
  } else {
    logsPostScreenSetup.push(msg);
  }
}

function fixupParamsOutput(prefixLength, input) {
  var lines = input.split('\n');
  lines = lines.slice(1);
  var prefix = ' '.repeat(prefixLength);
  var output = ""
  for (line of lines) {
    output += `${prefix}${line}\n`;
  }
  return output;
}

function showPostScreenSetupLogs() {
  for (var log of logsPostScreenSetup) {
    $('#logviewcontents').append(log);
    $("#logview").scrollTop($("#logviewcontents").height());
  }
  isScreenSetup = true;
}

function setCodeToMessage(file, message) {
  $('#codeframe').attr('src', null);
  setTimeout(function () {
    $('#codeframe').attr('src', 'ignore/code.html#../' + file + '/' + encodeURI(message));
  }, 0);
}