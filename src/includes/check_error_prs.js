const runtime = require('../runtime.js');

module.exports = async () => {
  runtime.prs
    .filter(pr => pr.state.error != null && pr.hours_since_post >= 48)
    .forEach(pr => {
      const channel = runtime.get_channel(pr.channel);
      channel.remove_pr(pr);
    });
};
