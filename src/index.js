require('dotenv').config();

const {
  registerPR,
  unregisterPR,
  hasPR,
  getPRs,
  updatePR,
} = require('./db.js');

const { onPRMessage } = require('./slack.js');
const { createPR, checkPR, addReaction, removeReaction } = require('./pr.js');
const { EMOJIS } = require('./consts.js');

const check = async meta => {
  const {
    merged,
    quick,
    reviewed,
    changesRequested,
    approved,
    needsAttention,
  } = await checkPR(meta);

  if (needsAttention) {
    await addReaction(EMOJIS.needsAttention, meta);
  }

  if (changesRequested) {
    await addReaction(EMOJIS.changes, meta);
  } else {
    await removeReaction(EMOJIS.changes, meta);
    if (approved) {
      await addReaction(EMOJIS.approved, meta);
    }
  }

  if (quick) {
    await addReaction(EMOJIS.quick_read, meta);
  }

  if (reviewed) {
    await addReaction(EMOJIS.commented, meta);
  }

  if (merged) {
    await addReaction(EMOJIS.merged, meta);
    await removeReaction(EMOJIS.needsAttention, meta);
    unregisterPR(meta);
  } else {
    updatePR(meta);
  }
};

onPRMessage(({ user, repo, prID, slug, channel, timestamp }) => {
  try {
    if (hasPR(slug)) {
      return console.log(`${slug} is already being watched`);
    }
    console.log(`Watching ${slug}`);

    const meta = createPR({
      slug,
      user,
      repo,
      prID,
      channel,
      timestamp,
    });

    registerPR(meta);
    check(meta);
  } catch (error) {
    console.log(error);
  }
});

function loop() {
  const PRs = getPRs();
  console.clear();
  console.log(`Watch list size: ${PRs.length}`);
  console.log('--------');
  for (const meta of PRs) {
    check(meta);
  }
}

loop();
setInterval(loop, 65 * 1000);
