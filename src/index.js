require('dotenv').config();

const {
  registerPR,
  unregisterPR,
  hasPR,
  getPRs,
  updatePR,
} = require('./db.js');

const { onPRMessage } = require('./slack.js');
const { createPR, checkPR, addReaction } = require('./pr.js');
const { EMOJIS } = require('./consts.js');

const check = async meta => {
  console.log(`Checking ${meta.slug}`);
  const { merged, quick, reviewed } = await checkPR(meta);

  if (quick) {
    await addReaction(EMOJIS.quick_read, meta);
  }

  if (reviewed) {
    await addReaction(EMOJIS.commented, meta);
  }

  if (merged) {
    console.log(`- Merged`);
    await addReaction(EMOJIS.merged, meta);
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

setInterval(
  (function loop() {
    const PRs = getPRs();
    console.clear();
    console.log(`Watch list size: ${PRs.length}`);
    for (const meta of PRs) {
      check(meta);
    }
    return loop;
  })(),
  65 * 1000,
);
