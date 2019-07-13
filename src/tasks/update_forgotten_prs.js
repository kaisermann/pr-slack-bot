const DB = require('../api/db.js');

const Logger = require('../api/logger.js');
const { EMOJIS } = require('../consts.js');
const Message = require('../message.js');

module.exports = async pr => {
  const messages = DB.get_channel_messages(pr.channel, 'forgotten_prs').filter(
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

    Logger.log_pr_action(`Updating forgotten PR message: ${pr.slug}`);
    Message.update(message, new_text).then(() => {
      if (message.payload.length === 1) {
        DB.remove_channel_message(message);
      } else {
        DB.update_channel_message(message, draft => {
          draft.text = new_text;
          draft.payload = draft.payload.filter(slug => slug !== pr.slug);
        });
      }
    });
  }
};
