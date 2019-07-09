const DB = require('../api/db.js');
const Metrics = require('../api/metrics.js');
const update_PR = require('./update_PR.js');

module.exports = async function checkPRs() {
  const PRs = DB.getPRs();

  console.log(`PRs being watched (${PRs.length}):`);
  console.log('');
  for await (const pr of PRs) {
    console.log(
      `${pr.slug} | ${pr.channel} | ${pr.ts} (${pr.hoursSincePost} hours ago)`,
    );
    await update_PR(pr);
    console.log('');
  }
  console.log('--------');
  console.log('');

  Metrics.log();
  Metrics.reset();
};
