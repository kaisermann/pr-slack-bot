require('dotenv/config');

const DB = require('../api/db.js');
const Slack = require('../api/slack.js');
const Logger = require('../api/logger.js');

const { GITHUB_FIELD_ID } = require('../consts.js');

module.exports = async () => {
  Logger.add_call('slack.users.list');
  const list_response = await Slack.web_client.users.list();
  if (!list_response.ok) return;

  const users = list_response.members;
  let db_user_transaction = DB.client.get('users');

  Logger.log(`Updating users`);
  const users_promise = users.map(
    async ({ id, profile: { display_name } }) => {
      const user_info = await Slack.get_user_info(id);

      if (
        !user_info ||
        !user_info.profile ||
        !user_info.profile.fields ||
        !user_info.profile.fields[GITHUB_FIELD_ID]
      )
        return;

      const github_user = user_info.profile.fields[
        GITHUB_FIELD_ID
      ].value.replace(/(?:https:\/\/github.com\/|^@)([\w-.]*)?/, '$1');

      db_user_transaction = db_user_transaction.push({
        id,
        slack_user: display_name,
        github_user,
      });

      // Logger.log(`Getting user [${i}]: ${id}, ${display_name}, ${github_user}`);
    },
  );

  await Promise.all(users_promise);

  Logger.log(`Users updated`);
  db_user_transaction.write();
};
