// Is the deployed Apps Script the version in this repository?
//
// Code.gs does not deploy with the site. Someone has to paste it into the Apps
// Script editor and publish a new version, and every time that step was missed
// the symptom was a change that appeared to do nothing. This asks the live Web
// App which version it is running.
//
//   npm run check:backend
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8');
const site = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const expected = (code.match(/var BACKEND_VERSION = '([^']+)'/) || [])[1];
const apiUrl = (site.match(/const API_URL = "([^"]+)"/) || [])[1];

if (!expected) {
  console.error('No BACKEND_VERSION in apps-script/Code.gs');
  process.exit(1);
}
if (!apiUrl) {
  console.error('No API_URL in index.html');
  process.exit(1);
}

console.log('repository : ' + expected);
process.stdout.write('deployed   : ');

fetch(apiUrl + '?action=getConfig', { redirect: 'follow' })
  .then(res => res.json())
  .then(config => {
    const live = config.backendVersion;
    if (!live) {
      console.log('(not reported)');
      console.log('\nThe deployed script predates version reporting, so it is');
      console.log('certainly older than this repository.');
      console.log(next());
      process.exit(1);
    }
    console.log(live);
    if (live === expected) {
      console.log('\nUp to date.');
      process.exit(0);
    }
    console.log('\nThe deployed backend is NOT the one in this repository.');
    console.log(next());
    process.exit(1);
  })
  .catch(err => {
    console.log('unreachable');
    console.error('\nCould not reach the Web App: ' + err.message);
    process.exit(1);
  });

function next() {
  return [
    '',
    'To update it:',
    '  1. Open the Apps Script project bound to the booking Sheet',
    '  2. Replace Code.gs with apps-script/Code.gs from this repository',
    '  3. Deploy > Manage deployments > edit > New version > Deploy'
  ].join('\n');
}
