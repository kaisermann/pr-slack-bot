const Logger = require('../api/logger.js');
const runtime = require('../runtime.js');
const { MAX_PRS } = require('../consts.js');

module.exports = async () => {
  const { channels, prs } = runtime;

  const channel_updates = await Promise.all(
    channels.map(channel => channel.update_prs()),
  );

  console.log('');
  console.log('--------------');
  console.log(prs.map(pr => pr.slug));
  console.log('--------------');
  console.log(`Total PRs: ${prs.length}/${MAX_PRS}`);

  Logger.log_metrics();
  Logger.reset_metrics();

  return channel_updates;
};
