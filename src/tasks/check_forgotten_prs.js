const runtime = require('../runtime.js');

module.exports = async () => {
  const { channels } = runtime;
  channels.forEach(channel => channel.check_forgotten_prs());
};
