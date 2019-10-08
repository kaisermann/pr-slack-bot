const runtime = require('../runtime.js');

module.exports = () => {
  const { channels } = runtime;
  return Promise.all(channels.map(channel => channel.update().catch(e => e)));
};
