/* eslint-env node, browser */

const yargs = require('yargs');

const argv = yargs
  .usage('Usage: $0 <username> <password>')
  .demandCommand(2)
  .option('email', { alias: 'e', description: "user's email", type: 'string', default: 'foo@example.com' })
  .option('origin', { alias: 'o', description: 'base URL of the server', type: 'string', default: 'http://127.0.0.1:8000' })
  .help()
  .alias('help', 'h')
  .argv;

createUser(argv._[0], argv._[1], argv.email, argv.origin)
  .catch(err => console.error(`error: ${err}`));

async function createUser (username, password, email, origin) {
  console.log(`creating user “${username}” ${email} at ${origin}`);
  const signupUrl = new URL('signup', origin);
  signupUrl.searchParams.set('username', username);
  signupUrl.searchParams.set('password', password);
  signupUrl.searchParams.set('email', email);
  // console.log(`signupUrl: ${signupUrl.href}`);
  const response = await fetch(signupUrl, {
    method: 'POST'
  });
  if (response.ok) {
    console.log(`${response.status} ${response.statusText}`);
    // console.log(`${response.status} ${response.statusText} ${await response.text()}`);
  } else {
    console.error(`${response.status} ${response.statusText}`);
    // console.error(`${response.status} ${response.statusText} ${await response.text()}`);
  }
  return response.status;
}
