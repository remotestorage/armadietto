/* eslint-env browser es2022 */

import {startAuthentication} from './simplewebauthn-browser.js';

document.querySelector('form')?.addEventListener('submit', submit);

async function submit(evt) {
  try {
    evt.preventDefault();
    if (evt.submitter.name !== 'allow') {
      const redirect = document.querySelector('input[name=redirect_uri]').value;
      console.info(`authorization denied; redirecting to`, redirect);
      document.location = redirect;
      return;
    }

    displayMessage('authorizing');

    // @simplewebauthn/server -> generateAuthenticationOptions()
    const options = JSON.parse(document.getElementById('options').value);
    console.log(`credentials options:`, options);
    if (Object.keys(options).length === 0) {
      throw new Error("Reload this page");
    }

    // Passes the options to the authenticator and waits for a response
    const credential = await startAuthentication(options);
    console.log(`credential:`, credential);
    document.getElementById('credential').value = JSON.stringify(credential);

    // POSTs the response to the endpoint that calls
    // @simplewebauthn/server -> verifyAuthenticationResponse()
    evt.target.submit();
  } catch (err) {
    document.getElementById('progress').hidden = true;
    if (err.code === 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY') {
      err = err.cause;
    }
    console.error(err, err.code || '', err.cause || '', err.cause?.code || '');

    if (err.name === 'AbortError') {
      displayMessage('Validating passkey aborted')
    } else {
      displayMessage(err.message || err.toString(), true);
    }
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
