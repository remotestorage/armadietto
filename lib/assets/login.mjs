/* eslint-env browser es2022 */

import {startAuthentication} from './simplewebauthn-browser.js';

// login().catch(err => {
//   err = preprocessError(err);
//   console.log(`logging-in on load:`, err, err.code || '', err.cause || '', err.cause?.code || '');
//
//   document.getElementById('login').hidden = false;
  document.getElementById('login')?.addEventListener('click', loginCatchingErrors);
  displayMessage('Click the button below to log in with a passkey. If you need to create a passkey on this device, ask an admin for an invitation');
// });

async function loginCatchingErrors() {
  try {
    await login();
  } catch (err) {
    err = preprocessError(err);
    console.error(err, err.code || '', err.cause || '', err.cause?.code || '');

    if (err.name === 'AbortError') {
      displayMessage('Validating passkey aborted')
    } else {
      displayMessage(err.message || err.toString(), true);
    }
  }
}

function preprocessError(err) {
  document.getElementById('progress').hidden = true;
  if (err.code === 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY') {
    return err.cause;
  } else {
    return err;
  }
}

async function login() {
  displayMessage('Logging in');

  // @simplewebauthn/server -> generateAuthenticationOptions()
  const options = JSON.parse(document.getElementById('options').value);
  // console.log(`credentials options:`, options)

  // Passes the options to the authenticator and waits for a response
  const credential = await startAuthentication(options);
  // console.log(`credential:`, credential)

  // POST the response to the endpoint that calls
  // @simplewebauthn/server -> verifyAuthenticationResponse()
  const verificationResp = await fetch('./verify-authentication', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',},
    body: JSON.stringify(credential),
  });

  // Wait for the results of verification
  const verificationJSON = await verificationResp.json();

  // Show UI appropriate for the `verified` status
  if (verificationJSON?.verified) {
    displayMessage(`Logged in as ${verificationJSON.username}`);
    document.getElementById('login').hidden = true;
    if (document.location.pathname.startsWith('/admin')) {
      document.location = '/admin/users';
    } else {
      document.location = '/account/';
    }
  } else {
    displayMessage(verificationJSON?.msg || JSON.stringify(verificationJSON), true);
  }
}

function displayMessage(msg, isError) {
  const elmtMsg = document.getElementById('message');
  elmtMsg.innerText = msg;
  if (isError) {
    elmtMsg.classList.add('error');
  } else {
    elmtMsg.classList.remove('error');
  }
}
