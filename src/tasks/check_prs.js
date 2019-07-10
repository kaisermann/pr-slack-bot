const DB = require('../api/db.js');
const Logger = require('../api/logger.js');
const update_pr = require('./update_pr_message.js');

module.exports = async () => {
  const channels = DB.get_channel_list();

  for await (const channel of channels) {
    const prs = DB.get_channel_prs(channel);

    Logger.log('=======================================');
    Logger.log(`Channel: ${channel} - ${prs.length} PRs`);
    Logger.log('');
    for await (const pr of prs) {
      Logger.log(
        `${pr.slug} | ${pr.channel} | ${pr.ts} (${pr.hours_since_post} hours ago)`,
      );
      await update_pr(pr);
    }
    Logger.log('=======================================');
    Logger.log('');
  }

  Logger.log_metrics();
  Logger.reset_metrics();
};
