const polka = require('polka');
const { urlencoded, json } = require('body-parser');

const { parse_github_webhook } = require('./github_webhook.js');
const { parse_slack_command } = require('./slack_command.js');
const { parse_slack_event } = require('./slack_event.js');

const Logger = require('../includes/logger.js');

exports.start = () => {
  polka()
    .use(urlencoded({ extended: true }))
    .use(json())
    .post('/github/webhooks', parse_github_webhook)
    .post('/slack/command', parse_slack_command)
    .post('/slack/event', parse_slack_event)
    .listen(12345, err => {
      if (err) throw err;
      Logger.info(`Server running on 12345`);
    });
};
