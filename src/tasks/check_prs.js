const Logger = require('../api/logger.js');
const runtime = require('../runtime.js');

module.exports = async () => {
  const { channels, prs } = runtime;

  await channels.reduce(
    async (acc, channel) => acc.then(channel.update_prs),
    Promise.resolve(),
  );

  console.log('');
  console.log(`Active PRs: ${prs.active.length}`);
  if (prs.inactive.length) {
    console.log(`Inactive PRs: ${prs.inactive.length}`);
  }

  Logger.log_metrics();
  Logger.reset_metrics();
};
