require('dotenv').config();

const cron = require('node-cron');
const DB = require('./db.js');

const Slack = require('./slack.js');
const Metrics = require('./metrics.js');
const PR = require('./pr.js');
const { ATTENTION_HOUR_THRESHOLD } = require('./consts.js');

const check = async pr => {
  const hasChanged = await pr.update();

  if (!hasChanged) {
    return;
  }

  if (pr.state.merged || pr.state.closed) {
    DB.unsetPR(pr);
  } else {
    DB.setPR(pr);
  }
};

Slack.onPRMessage(prMeta => {
  const { slug } = prMeta;

  if (DB.hasPR(slug)) {
    return console.log(`${slug} is already being watched`);
  }
  console.log(`Watching ${slug}`);

  const pr = PR.create(prMeta);

  DB.setPR(pr);
  check(pr);
});

async function checkPRs() {
  const PRs = DB.getPRs();

  console.log(`PRs being watched (${PRs.length}):`);
  console.log('');
  for await (const pr of PRs) {
    console.log(
      `${pr.slug} | ${pr.channel} | ${pr.timestamp} (${pr.hoursSincePost} hours ago)`,
    );
    await check(pr);
    console.log('');
  }
  console.log('--------');
  console.log('');

  Metrics.log();
  Metrics.reset();
}

async function checkAbandonedPRs() {
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

    // console.log(message, channel);
    Slack.sendMessage(message, channel);
  });
}

checkPRs();
cron.schedule('* * * * *', checkPRs, {
  scheduled: true,
  timezone: 'America/Sao_Paulo',
});

// checkAbandonedPRs();
cron.schedule('0 14 * * 1-5', checkAbandonedPRs, {
  scheduled: true,
  timezone: 'America/Sao_Paulo',
});
