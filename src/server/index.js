const path = require('path');
const polka = require('polka');
const { urlencoded, json } = require('body-parser');
const { parse_github_webhook } = require('./github_webhook.js');
const { parse_slack_command } = require('./slack_command.js');
const serve = require('serve-static')(path.join(__dirname, 'dashboard'), {});

exports.start = () => {
  polka()
    .use(urlencoded({ extended: true }))
    .use(json())
    .use('/dashboard', serve)
    .post('/github/webhooks', parse_github_webhook)
    .post('/slack/command', parse_slack_command)
    .listen(12345, err => {
      if (err) throw err;
      console.log(`Server running on 12345`);
    });
};
