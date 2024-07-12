/* eslint-env browser es2022 */

document.getElementById('reinviteSelf')?.addEventListener('click', resendInvite);

document.querySelector('table#users')?.addEventListener('click', resendInvite);
document.querySelector('form')?.addEventListener('submit', sendInvite);
document.getElementById('share')?.addEventListener('click', share);

document.querySelector('table#inviteRequests')?.addEventListener('click', resendInvite);

let invite;  // Global variables are are simpler when there is little code.

async function resendInvite(evt) {
  if (evt.target.dataset.contacturl) {
    if (evt.target.dataset.privilegegrant) {
      await submit(new URLSearchParams(evt.target.dataset));
    } else {
      await deleteInviteRequest(new URLSearchParams(evt.target.dataset));
    }
  }
}

async function sendInvite(evt) {
  evt.preventDefault();
  await submit(new URLSearchParams(new FormData(document.querySelector('form'))));
}

async function submit(data) {
  try {
    document.getElementById('progress').hidden = false;
    const resp = await fetch('/admin/sendInvite', {method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded'},
      body: data
    });
    document.getElementById('progress').hidden = true;
    if (resp.ok) {
      invite = await resp.json();
      console.info(`Invite created for “${data.get('username') || ''}” ${invite.contactURL}`);

      contactURLToLink(invite);

      if (typeof navigator.share === 'function') {
        document.getElementById('shareContainer').hidden = false;
      }

      displayOutput(invite.text + '\n' + invite.url, 'Or, copy and paste this invite to a secure channel:');
    } else {
      await displayNonsuccess(resp);
      if (resp.status === 401) {
        window.location = './login'
      }
    }
  } catch (err) {
    console.error(`while sending invite:`, err);
    displayOutput('Check your connection', err.message, true);
  }
}

async function deleteInviteRequest(data) {
  try {
    document.getElementById('progress').hidden = false;
    const resp = await fetch('/admin/deleteInviteRequest', {method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded'},
      body: data
    });
    document.getElementById('progress').hidden = true;
    if (resp.ok) {
      displayOutput('Request deleted', "Success", false);
      window.location.reload(true);
    } else {
      const text = await resp.text();
      console.error(`while deleting invite request:`, text);
      displayOutput(text, 'Unable to delete', true);
    }
  } catch (err) {
    console.error(`while deleting invite request:`, err);
    displayOutput('Check your connection', err.message, true);
  }
}

async function displayNonsuccess(resp) {
  let msg;
  switch (resp.headers.get('Content-Type')?.split(';')[0]) {
    case 'text/plain':
      const t = await resp.text();
      console.error(`Sending invite was rejected.`, t);
      msg = t;
      break;
    case 'application/json':
      const r = await resp.json();
      console.error(`Sending invite was rejected.`, r);
      msg = r?.message
      break;
    default:
      const t2 = await resp.text();
      console.error(`Sending invite was rejected.`, resp.headers.get('Content-Type'), t2);
      msg = 'Sending invite was rejected.';
  }
  displayOutput(msg, 'Something went wrong', true);
}

function displayOutput(msg, label = '', isError = false) {
  document.getElementById('outputDiv').hidden = false;

  const output = document.getElementById('output')
  output.innerText = msg;
  output.scrollIntoView({ behavior: "smooth", block: "end"});

  document.getElementById('outputLabel').innerText = label;

  if (isError) {
    output.classList.add('error');
  } else {
    output.classList.remove('error');
  }
}

function contactURLToLink(invite) {
  try {
    let mode = null;
    const contactURL = new URL(invite.contactURL)
    switch(contactURL.protocol) {
      case 'sgnl:': // sgnl://signal.me/#p/+15555555555
        mode = 'from my Signal Private Messenger account';
        break;
      case 'threema:': // threema://compose?id=ABCDEFGH&text=Test%20Text
        contactURL.searchParams.set('text', invite.text);
        mode = 'from my Threema account';
        break;
      case 'facetime:': // facetime:14085551234 or facetime:user@example.com
        mode = 'from my FaceTime account';
        break;
      case 'xmpp:': // xmpp:username@domain.tld
        mode = 'from my Jabber account';
        break;
      case 'skype:': // skype:<username|number>?[add|call|chat|sendfile|userinfo][&topic=foo]
        contactURL.search = `?chat&topic=${encodeURIComponent(invite.title)}`;
        mode = 'from my Skype account';
        break;
      case 'mailto:':
        contactURL.search = `?subject=${encodeURIComponent(invite.title)}&body=${encodeURIComponent(invite.text + '\n' + invite.url)}`;
        mode = 'from my email account';
        break;
      case 'sms:':
      case 'mms:':
        contactURL.search = `?body=${encodeURIComponent(invite.text + '\n' + invite.url)}`;
        mode = 'from my messaging account';
        break;
      case 'whatsapp:': // whatsapp://send/?phone=447700900123
        contactURL.search += `&text=${encodeURIComponent(invite.text + '\n' + invite.url)}`;
        mode = 'from my WhatsApp account';
        // TODO: support https://wa.me/15551234567
        break;
      case 'tg:': // tg://msg?to=+1555999
        contactURL.search += `&text=${encodeURIComponent(invite.text + '\n' + invite.url)}`;
        mode = 'from my Telegram account';
        break;
    }

    if (mode) {
      document.getElementById('sendFromMe').href = contactURL;
      document.getElementById('sendFromMe').innerText = `Send invite ${mode}`;
      document.getElementById('sendFromMeContainer').hidden = false;
    }
  } catch (err) {
    console.error(`while assembling link:`, err);
  }
}
function share() {
  navigator.share(invite).catch(console.error);
}
