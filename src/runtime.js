const DB = require('./api/db.js');
const Slack = require('./api/slack.js');
const Channel = require('./channel.js');

const channels = DB.channels
  .values()
  .value()
  .map(Channel.create);
const users = DB.users.value();

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
  get channels() {
    return channels;
  },
  get users() {
    return users;
  },
  get prs() {
    return channels.flatMap(channel => channel.prs);
  },
};
