const DB = require('../api/db.js');
const Slack = require('../api/slack.js');
const { ATTENTION_HOUR_THRESHOLD } = require('../consts.js');

module.exports = async function checkignoredPRs() {
  const channels = Object.entries(
    DB.getPRs()
      .filter(pr => pr.needsAttention(ATTENTION_HOUR_THRESHOLD))
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
      const messageUrl = await pr.getMessageUrl();
      message += `<${messageUrl}|${pr.slug}>`;
      message += ` _(${pr.hoursSincePost} hours ago)_\n`;
    }

    const response = await Slack.sendMessage(message, channel);
    if (response) {
      const {
        ts,
        message: { text },
      } = response;
      const messageInfo = {
        ts,
        channel,
        text,
        type: 'ignored_prs',
        payload: prs.map(pr => pr.slug),
      };
      DB.saveMessage(messageInfo, 3);
    }
  });
};
