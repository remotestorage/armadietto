/**
 * Instrument a "candidate" response to be used throughout middleware
 * and used to substitute a final result at end.
 * 
 * @param {*} res -- original response
 * @returns {*} the candidate response object
 */
function substituteInCandidateResponse(res) {
  let candidate = { 
    original: res ,
    code: null,
    headers: null,
    content: null,
    value: null
  };
  candidate.writeHead = (code, headers) => {
    candidate.code = code;
    candidate.headers = headers;
  };
  candidate.write = (content) => {
    candidate.content = content;
  };
  candidate.end = (value) => {
    candidate.value = value;
  };
  candidate.getCandidate = () => candidate;

  return candidate;
}

/**
 * Render the reasl response out of the candidate response.
 * 
 * @param {*} candidateResponse
 */
function writeOutRealResponse(candidateResponse) {
  const response = candidateResponse.original;
  if (candidateResponse.code) {
    response.writeHead(candidateResponse.code, candidateResponse.headers);
  }
  if (candidateResponse.content) {
    response.write(candidateResponse.content);
  }
  candidateResponse.value ? response.end(candidateResponse.value) : response.end();
}


module.exports = { substituteInCandidateResponse, writeOutRealResponse };