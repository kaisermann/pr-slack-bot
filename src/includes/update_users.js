require('dotenv/config');

const DB = require('../api/db.js');
const Slack = require('../api/slack.js');
const Logger = require('./logger.js');

const { GITHUB_FIELD_ID } = require('../consts.js');

module.exports = async () => {
  Logger.add_call('slack.users.list');
  const list_response = await Slack.web_client.users.list();
  if (!list_response.ok) return;

  const active_users = list_response.members.filter(
    user => user.deleted !== true,
  );
  let transaction = DB.users;

  Logger.info(`Updating users`);
  const users_promise = active_users.map(
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

      transaction = transaction.set(id, {
        id,
        slack_user: display_name,
        github_user,
      });

      // console.log(`Getting user [${i}]: ${id}, ${display_name}, ${github_user}`);
    },
  );

  await Promise.all(users_promise);

  Logger.info(`Users updated`);
  transaction.write();
};
