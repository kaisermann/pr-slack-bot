const DB = require('../api/db.js');
const Slack = require('../api/slack.js');
const Logger = require('./logger.js');

const { GITHUB_FIELD_ID } = require('../consts.js');

module.exports = async () => {
  let groups_transaction = DB.users.get('groups');

  const groups = await Slack.get_user_groups();
  for (let group of groups) {
    if (group.deleted_by || group.users == null || group.users.length === 0) {
      continue;
    }

    groups_transaction = groups_transaction.set(group.id, {
      id: group.id,
      handle: group.handle,
      name: group.name,
      users: group.users,
    });
  }
  groups_transaction.write();
  Logger.info(`Groups updated`);

  let users_transaction = DB.users.get('members');
  for await (const user of Slack.get_users()) {
    const {
      id,
      profile: { status_text, display_name, fields },
    } = user;
    if (!fields || !fields[GITHUB_FIELD_ID]) continue;

    const github_user = fields[GITHUB_FIELD_ID].value.replace(
      /(?:https:\/\/github.com\/|^@)([\w-.]*)?/,
      '$1',
    );

    users_transaction = users_transaction.set(id, {
      id,
      slack_user: display_name,
      github_user,
      status_text,
    });
  }

  Logger.info(`Users updated`);
  users_transaction.write();
};
