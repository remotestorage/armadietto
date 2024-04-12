/* eslint-env browser es2022 */

import {startRegistration} from './simplewebauthn-browser.js';

const usernameInpt = document.getElementById('username');
usernameInpt.addEventListener('change', getOptions);
let username = usernameInpt.value;
if (username) {
  getOptions().catch(console.error);
}

let options; // global variables are the least-bad solution for simple pages

async function getOptions() {
  try {
    username = usernameInpt.value;
    const response = await fetch('/admin/getRegistrationOptions', {
      method: 'POST',
      headers: {'Content-type': 'application/json'},
      body: JSON.stringify({username})
    });
    if (response.ok) {
      options = await response.json()

      usernameInpt.readOnly = true;
      const btn = document.querySelector('button#register')
      btn.hidden = false;
      btn.addEventListener('click', generateCatchingErrors);
      displayMessage('Click the button below to create a passkey on this device');
    } else {
      const body = await response.json();
      if (body.error) {
        displayMessage(body.error, true);
      } else {
        displayMessage(`Something went wrong. Request another invite.`, true);
      }
    }
  } catch (err) {
    console.error(`while fetching options:`, err);
    displayMessage(`Something went wrong. Request another invite.`, true);
    await cancelInvite()
  }
}

async function generateCatchingErrors() {
  try {
    await generateAndRegisterPasskey();
  } catch (err) {
    document.getElementById('progress').hidden = true;
    if (err.code === 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY') { err = err.cause; }
    console.error(err, err.code || '', err.cause || '', err.cause?.code || '');

    if (err.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
      document.querySelector('button#register').hidden = true;
      displayMessage('You have already created a passkey on this device. Just log in, using the “Log in” link at the top!');
      await cancelInvite()
    } else if (err.name === 'AbortError') {
      displayMessage('Creating passkey aborted')
    } else if (err.name === 'InvalidStateError') {
      displayMessage('You already have a passkey:' + err.message, false);
      await cancelInvite()
    } else {
      displayMessage(err.message || err.toString(), true);
      await cancelInvite();
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

async function generateAndRegisterPasskey() {
  displayMessage('Creating passkey');

  console.log(`credentials options:`, options)

  document.getElementById('progress').hidden = false;
  // Passes the options to the authenticator and waits for a response
  const attResp = await startRegistration(options);
  // console.log(`attResp:`, attResp)

  // POST the response to the endpoint that calls
  // @simplewebauthn/server -> verifyRegistrationResponse()
  const searchParams = new URLSearchParams(document.location.search)
  const verificationUrl = new URL('/admin/verifyRegistration?token=' + searchParams.get('token'), document.location.origin)
  const verificationResp = await fetch(verificationUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(attResp),
  });
  document.getElementById('progress').hidden = true;

  if (verificationResp.ok) {
    // Waits for the results of verification
    const verificationJSON = await verificationResp.json();
    // console.log(`verificationJSON:`, verificationJSON)

    if (verificationJSON?.verified) {
      displayMessage('Verified and saved on server!', false);
      document.location = '/account';
    } else {
      displayMessage(`Something went wrong! ${JSON.stringify(verificationJSON)}`, true);
    }
  } else {
    displayMessage('Check your connection', true);
  }
}

async function cancelInvite() {
  const searchParams = new URLSearchParams(document.location.search)
  const cancelUrl = new URL('/admin/cancelInvite?token=' + searchParams.get('token'), document.location.origin)
  const cancelResp = await fetch(cancelUrl, {method: 'POST'});
  if (!cancelResp.ok) {
    console.error(`while cancelling invite:`, await cancelResp.text());
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
