require('dotenv').config();

const cron = require('node-cron');
const DB = require('./db.js');

const { onPRMessage, sendMessage } = require('./slack.js');
const PR = require('./pr.js');
const { EMOJIS, ATTENTION_HOUR_THRESHOLD } = require('./consts.js');

const check = async meta => {
  const {
    merged,
    quick,
    reviewed,
    approved,
    changesRequested,
    closed,
    unstable,
  } = await PR.check(meta);

  if (changesRequested) {
    await PR.addReaction(EMOJIS.changes, meta);
  } else {
    await PR.removeReaction(EMOJIS.changes, meta);
  }

  if (quick) {
    await PR.addReaction(EMOJIS.quick_read, meta);
  }

  if (reviewed) {
    await PR.addReaction(EMOJIS.commented, meta);
  }

  if (unstable) {
    await PR.addReaction(EMOJIS.unstable, meta);
  } else {
    await PR.removeReaction(EMOJIS.unstable, meta);
  }

  if (approved && !unstable && !merged && !closed) {
    await PR.sendMessage(
      meta,
      'ready_to_merge',
      'PR is ready to be merged :doit:!',
    );
  }

  if (merged || closed) {
    if (merged) {
      await PR.addReaction(EMOJIS.merged, meta);
    } else {
      await PR.addReaction(EMOJIS.closed, meta);
    }
    DB.unsetPR(meta);
  } else {
    DB.setPR(meta);
  }

  console.log('');
};

onPRMessage(({ user, repo, prID, slug, channel, timestamp }) => {
  try {
    if (DB.hasPR(slug)) {
      return console.log(`${slug} is already being watched`);
    }
    console.log(`Watching ${slug}`);

    const meta = PR.create({
      slug,
      user,
      repo,
      prID,
      channel,
      timestamp,
    });

    DB.setPR(meta);
    check(meta);
  } catch (error) {
    console.log(error);
  }
});

async function checkPRs() {
  const PRs = DB.getPRs();
  console.clear();
  console.log(`Watch list size: ${PRs.length}`);
  console.log('--------');
  for await (const meta of PRs) {
    await check(meta);
  }
}

async function listAbandonedPRs() {
  const prs = DB.getPRs().filter(pr =>
    PR.needsAttention(pr, ATTENTION_HOUR_THRESHOLD),
  );
  if (!prs.length) return;

  let message =
    'Hello :wave: Paulo Roberto here!\nThere are some PRs posted more than 24 hours ago needing attention:\n\n';

  for await (const pr of prs) {
    const messageUrl = await PR.getMessageUrl(pr);
    message += `<${messageUrl}|${pr.slug}>\n`;
  }

  console.log(message);
  sendMessage(message, prs[0].channel);
}

checkPRs();
cron.schedule('* * * * *', checkPRs, {
  scheduled: true,
  timezone: 'America/Sao_Paulo',
});

// listAbandonedPRs();
// cron.schedule('0 15,18 * * 1-5', listAbandonedPRs, {
//   scheduled: true,
//   timezone: 'America/Sao_Paulo',
// });
