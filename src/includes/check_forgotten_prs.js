const runtime = require('../runtime.js');

module.exports = async () => {
  Object.values(runtime.channels).forEach(channel =>
    channel.check_forgotten_prs(),
  );
};
