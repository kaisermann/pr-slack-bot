const DB = require('../api/db.js');
const Slack = require('../api/slack.js');
const { FORGOTTEN_PR_HOUR_THRESHOLD } = require('../consts.js');

module.exports = () => {
  const channels = Object.entries(
    DB.get_prs()
      .filter(pr => pr.needs_attention(FORGOTTEN_PR_HOUR_THRESHOLD))
      .reduce((acc, pr) => {
        if (!acc[pr.channel]) acc[pr.channel] = [];
        acc[pr.channel].push(pr);
        return acc;
      }, {}),
  );

  if (!channels.length) return;

  channels.forEach(async ([channel, prs]) => {
    let message =
      'Hello :wave: Paul Robertson here!\nThere are some PRs posted more than 24 hours ago needing attention:\n\n';

    for await (const pr of prs) {
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
        payload: prs.map(pr => pr.slug),
      };
      DB.save_message(message_info, 3);
    }
  });
};
