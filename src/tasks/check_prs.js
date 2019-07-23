const DB = require('../api/db.js');
const Logger = require('../api/logger.js');
const update_pr = require('./update_pr_message.js');
const { MAX_PRS } = require('../consts');

const runtime = require('../runtime.js');

const PR = require('../pr.js');

module.exports = async () => {
  const { channels } = runtime;
  const p = Promise.all(channels.map(channel => channel.update_prs()));

  return p;

  // await channels.reduce((channel_acc, channel) => {
  //   const prs = DB.get_channel_prs(channel);
  //   pr_count += prs.length;

  //   Logger.log('=======================================');
  //   Logger.log(`Channel: ${channel} - ${prs.length} PRs`);
  //   Logger.log('');
  //   const pr_promises = prs.map(pr => {
  //     Logger.log(`${pr.slug} | ${pr.ts} (${pr.hours_since_post} hours ago)`);
  //     return update_pr(pr);
  //   }, []);
  //   Logger.log('=======================================');
  //   Logger.log('');

  //   return channel_acc.then(() => Promise.all(pr_promises));
  // }, Promise.resolve());

  // Logger.log(`PR count: ${pr_count}/${MAX_PRS}\n`);
  // Logger.log_metrics();
  // Logger.reset_metrics();
};
