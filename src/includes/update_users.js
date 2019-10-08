const DB = require('../api/db.js');
const Slack = require('../api/slack.js');
const Logger = require('./logger.js');

const { GITHUB_FIELD_ID } = require('../consts.js');

module.exports = async () => {
  let transaction = DB.users;
  for await (const user of Slack.get_users()) {
    const {
      id,
      profile: { display_name, fields },
    } = user;
    if (!fields || !fields[GITHUB_FIELD_ID]) continue;

    const github_user = fields[GITHUB_FIELD_ID].value.replace(
      /(?:https:\/\/github.com\/|^@)([\w-.]*)?/,
      '$1',
    );

    transaction = transaction.set(id, {
      id,
      slack_user: display_name,
      github_user,
    });
  }

  Logger.info(`Users updated`);
  transaction.write();
};
