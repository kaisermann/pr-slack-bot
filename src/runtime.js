const DB = require('./api/db.js');
const Slack = require('./api/slack.js');
const Channel = require('./channel.js');

const channels = DB.channels
  .values()
  .value()
  .map(Channel.create);

module.exports = {
  get_channel(id) {
    return channels.find(channel => channel.id === id);
  },
  async create_channel(id) {
    const channel_info = await Slack.get_channel_info(id);
    const channel_data = {
      channel_id: id,
      name: channel_info.name,
      prs: [],
      messages: {},
    };
    const channel = Channel.create(channel_data);

    channels.push(channel);
    DB.channels.set(id, channel_data).write();
    return channel;
  },
  async get_or_create_channel(id) {
    return this.get_channel(id) || this.create_channel(id);
  },
  delete_channel(id) {
    const index = channels.findIndex(channel => channel.channel_id === id);
    channels.splice(index, 1);
    return DB.channels.unset(id).write();
  },
  get channels() {
    return channels;
  },
  get prs() {
    return channels.flatMap(channel => channel.prs);
  },
};
