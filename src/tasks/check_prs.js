const Logger = require('../api/logger.js');
const runtime = require('../runtime.js');

module.exports = async () => {
  const { channels } = runtime;

  const channel_updates = await Promise.all(
    channels.map(channel => channel.update_prs()),
  );

  Logger.log_metrics();
  Logger.reset_metrics();

  return channel_updates;
};
