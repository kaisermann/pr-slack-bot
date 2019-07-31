const Logger = require('../api/logger.js');
const runtime = require('../runtime.js');
const { MAX_PRS } = require('../consts.js');

module.exports = async () => {
  const { channels, prs } = runtime;

  await channels.reduce(
    async (acc, channel) => acc.then(channel.update_prs),
    Promise.resolve(),
  );

  console.log('');
  console.log(`Total PRs: ${prs.length}/${MAX_PRS}`);

  Logger.log_metrics();
  Logger.reset_metrics();
};
