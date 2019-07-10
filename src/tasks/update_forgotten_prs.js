require('dotenv').config();

const DB = require('../api/db.js');

const Slack = require('../api/slack.js');
const { EMOJIS } = require('../consts.js');

module.exports = pr => {
  DB.get_messages('forgotten_prs')
    .filter(({ payload }) => payload.indexOf(pr.slug) >= 0)
    .forEach(async message => {
      const { text } = message;
      const prState = pr.state.merged
        ? EMOJIS.merged
        : pr.state.closed
        ? EMOJIS.closed
        : EMOJIS.shrug;
      const newText = text.replace(
        new RegExp(`(<.*${pr.slug}>.*$)`, 'm'),
        `:${prState}: ~$1~`,
      );

      Slack.update_message(message, newText);
      if (message.payload.length === 1) {
        DB.remove_message(message);
      } else {
        DB.update_message(message, draft => {
          draft.text = newText;
          draft.payload = draft.payload.filter(slug => slug !== pr.slug);
        });
      }
    });
};
