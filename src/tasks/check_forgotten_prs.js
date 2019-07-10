const DB = require('../api/db.js');
const Slack = require('../api/slack.js');
const { FORGOTTEN_PR_HOUR_THRESHOLD } = require('../consts.js');

module.exports = async () => {
  const channels = DB.get_channel_list();

  for await (const channel of channels) {
    const forgotten_prs = DB.get_channel_prs(channel).filter(pr =>
      pr.needs_attention(FORGOTTEN_PR_HOUR_THRESHOLD),
    );

    if (forgotten_prs.length === 0) return;

    let message =
      'Hello :wave: Paul Robertson here!\nThere are some PRs posted more than 24 hours ago needing attention:\n\n';

    for await (const pr of forgotten_prs) {
      const message_url = await pr.get_message_url();
      message += `<${message_url}|${pr.slug}>`;
      message += ` _(${pr.hours_since_post} hours ago)_\n`;
    }

    const response = await Slack.send_message(message, channel);
    if (response) {
      const {
        ts,
        message: { text },
      } = response;
      const message_info = {
        ts,
        channel,
        text,
        type: 'forgotten_prs',
        payload: forgotten_prs.map(pr => pr.slug),
      };
      DB.save_message(message_info, 3);
    }
  }
};
