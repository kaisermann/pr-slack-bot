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
      : EMOJIS.unknown;
    const new_text = text.replace(
      new RegExp(`(<.*${pr.slug}>.*$)`, 'm'),
      `:${state_emoji}: ~$1~`,
    );

    Logger.log_pr_action(`Updating forgotten PR message: ${pr.slug}`);
    const updated_message = await Message.update(message, {
      text: new_text,
      payload: message.payload.filter(slug => slug !== pr.slug),
    });

    if (updated_message.payload.length === 0) {
      DB.remove_channel_message(updated_message);
    } else {
      DB.update_channel_message(updated_message);
    }
  }
};
