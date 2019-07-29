const Logger = require('../api/logger.js');
const runtime = require('../runtime.js');
const { MAX_PRS } = require('../consts.js');

module.exports = async () => {
  const { channels } = runtime;

  const total_prs = channels.reduce(
    (acc, channel) => acc + channel.prs.length,
    0,
  );

  const channel_updates = await Promise.all(
    channels.map(channel => channel.update_prs()),
  );

  console.log('');
  console.log(`Total PRs: ${total_prs}/${MAX_PRS}`);

  Logger.log_metrics();
  Logger.reset_metrics();

  return channel_updates;
};
