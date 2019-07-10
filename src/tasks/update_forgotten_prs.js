const DB = require('../api/db.js');

const Slack = require('../api/slack.js');
const Logger = require('../api/logger.js');
const { EMOJIS } = require('../consts.js');

module.exports = async pr => {
  const messages = DB.get_messages(pr.channel, 'forgotten_prs').filter(
    ({ payload }) => payload.indexOf(pr.slug) >= 0,
  );

  for await (const message of messages) {
    const { text } = message;
    const state_emoji = pr.state.merged
      ? EMOJIS.merged
      : pr.state.closed
      ? EMOJIS.closed
      : EMOJIS.shrug;
    const new_text = text.replace(
      new RegExp(`(<.*${pr.slug}>.*$)`, 'm'),
      `:${state_emoji}: ~$1~`,
    );

    Slack.update_message(message, new_text);
    Logger.log_pr_action(`Updating forgotten PR message: ${pr.slug}`);

    if (message.payload.length === 1) {
      DB.remove_message(message);
    } else {
      DB.update_message(message, draft => {
        draft.text = new_text;
        draft.payload = draft.payload.filter(slug => slug !== pr.slug);
      });
    }
  }
};
