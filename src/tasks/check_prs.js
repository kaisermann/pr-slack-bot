const DB = require('../api/db.js');
const Metrics = require('../api/metrics.js');
const update_pr = require('./update_pr_message.js');

module.exports = async () => {
  const PRs = DB.get_prs();

  console.log(`PRs being watched (${PRs.length}):`);
  console.log('');
  for await (const pr of PRs) {
    console.log(
      `${pr.slug} | ${pr.channel} | ${pr.ts} (${pr.hours_since_post} hours ago)`,
    );
    await update_pr(pr);
    console.log('');
  }
  console.log('--------');
  console.log('');

  Metrics.log();
  Metrics.reset();
};
