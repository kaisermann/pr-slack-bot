require('dotenv').config();

const cron = require('node-cron');
const DB = require('./db.js');

const { onPRMessage, sendMessage } = require('./slack.js');
const PR = require('./pr.js');
const { EMOJIS } = require('./consts.js');

const check = async meta => {
  const {
    merged,
    quick,
    reviewed,
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

  if (merged || closed) {
    if (merged) {
      await PR.addReaction(EMOJIS.merged, meta);
    } else {
      await PR.addReaction(EMOJIS.closed, meta);
    }
    DB.unregisterPR(meta);
  } else {
    DB.updatePR(meta);
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

    DB.registerPR(meta);
    check(meta);
  } catch (error) {
    console.log(error);
  }
});

function checkPRs() {
  const PRs = DB.getPRs();
  console.clear();
  console.log(`Watch list size: ${PRs.length}`);
  console.log('--------');
  for (const meta of PRs) {
    check(meta);
  }
}

async function listAbandonedPRs() {
  const prs = DB.getPRs().filter(pr => PR.needsAttention(pr, 0));
  if (!prs.length) return;

  let message =
    'Hello :wave Paulo Ricardo here! There are some PRs needing attention:\n\n';

  for await (const pr of prs) {
    const messageUrl = await PR.getMessageUrl(pr);
    message += `<${messageUrl}|${pr.slug}>\n`;
  }

  console.log(message);
  // sendMessage(message, prs[0].channel);
}

checkPRs();
cron.schedule('* * * * *', checkPRs, {
  scheduled: true,
  timezone: 'America/Sao_Paulo',
});

// listAbandonedPRs();
// cron.schedule('0 15 * * 1-5', listAbandonedPRs, {
//   scheduled: true,
//   timezone: 'America/Sao_Paulo',
// });
