const DB = require('../api/db.js');
const Logger = require('../api/logger.js');
const { FORGOTTEN_PR_HOUR_THRESHOLD } = require('../consts.js');
const Message = require('../message.js');

module.exports = async () => {
  const channels = DB.get_channel_list();

  for await (const channel of channels) {
    const forgotten_prs = DB.get_channel_prs(channel).filter(pr =>
      pr.needs_attention(FORGOTTEN_PR_HOUR_THRESHOLD),
    );

    if (forgotten_prs.length === 0) continue;

    let text =
      'Hello :wave: Paul Robertson here!\nThere are some PRs posted more than 24 hours ago needing attention:\n\n';

    for await (const pr of forgotten_prs) {
      const message_url = await pr.get_message_url();
      text += `<${message_url}|${pr.slug}>`;
      text += ` _(${pr.hours_since_post} hours ago)_\n`;
    }

    Message.send({
      type: 'forgotten_prs',
      channel,
      text,
      payload: forgotten_prs.map(pr => pr.slug),
    })
      .then(message => DB.save_channel_message(message, 3))
      .catch(e => Logger.log_error(e));
  }
};
