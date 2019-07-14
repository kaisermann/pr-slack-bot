const DB = require('../api/db.js');
const Logger = require('../api/logger.js');
const update_pr = require('./update_pr_message.js');
const { MAX_PRS } = require('../consts');

module.exports = async () => {
  const channels = DB.get_channel_list();
  let pr_count = 0;

  for await (const channel of channels) {
    const prs = DB.get_channel_prs(channel);
    pr_count += prs.length;

    Logger.log('=======================================');
    Logger.log(`Channel: ${channel} - ${prs.length} PRs`);
    Logger.log('');
    for await (const pr of prs) {
      Logger.log(`${pr.slug} | ${pr.ts} (${pr.hours_since_post} hours ago)`);
      await update_pr(pr);
    }
    Logger.log('=======================================');
    Logger.log('');
  }

  Logger.log(`PR count: ${pr_count}/${MAX_PRS}\n`);
  Logger.log_metrics();
  Logger.reset_metrics();
};
