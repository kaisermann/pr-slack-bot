const DB = require('./api/db.js');
const Slack = require('./api/slack.js');
const Channel = require('./channel.js');

const [users_data, channels_data] = [DB.get_users(), DB.get_channels()];
const channels = Object.values(channels_data).map(Channel.create);
const users = users_data;

module.exports = {
  init() {},
  get_channel(id) {
    return channels.find(channel => channel.channel_id === id);
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
    DB.client
      .get('channels')
      .set(id, channel_data)
      .write();
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
    const prs = channels.flatMap(channel => channel.prs);
    return prs.reduce(
      (acc, pr) => {
        if (pr.is_active()) acc.active.push(pr);
        else acc.inactive.push(pr);
        return acc;
      },
      {
        active: [],
        inactive: [],
        all: prs,
      },
    );
  },
};
