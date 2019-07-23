const low = require('lowdb');
const FileSyncAdapter = require('lowdb/adapters/FileSync');
const PR = require('../pr.js');

const db = low(new FileSyncAdapter('db.json'));

db.defaults({
  users: {},
  channels: {},
}).write();

const channel_message_path = (channel, type) =>
  ['channels', channel, 'messages', type].filter(Boolean);

const pr_path = channel => ['channels', channel, 'prs'];

exports.client = db;

exports.transaction = (...parts) => {
  return parts.reduce((acc, part) => part(acc)).write();
};

exports.get_channel_list = () =>
  db
    .get('channels')
    .keys()
    .value();

exports.get_channel_prs = channel => {
  return db
    .get(pr_path(channel))
    .values()
    .map(PR.create)
    .value();
};

exports.has_channel = channel => {
  return db
    .get('channels')
    .has(channel)
    .value();
};

exports.create_channel = channel => {
  return db
    .get('channels')
    .set(channel, {
      channel_id: channel,
      prs: [],
      messages: {},
    })
    .write();
};

exports.get_channel_messages = (channel, type) => {
  return db.get(channel_message_path(channel, type), []).value();
};

exports.remove_channel_message = message => {
  const { channel, ts, type } = message;
  db.get(channel_message_path(channel, type), [])
    .remove({ ts, channel })
    .write();
};

exports.update_channel_message = updated_message => {
  const { type, channel, ts } = updated_message;
  db.get(channel_message_path(channel, type))
    .find({ ts, channel })
    .assign(updated_message)
    .write();
};

exports.save_channel_message = (message, limit) => {
  const { type, channel } = message;
  let messages_of_type = db
    .get(channel_message_path(channel, type), [])
    .push(message);

  if (typeof limit === 'number') {
    messages_of_type = messages_of_type.takeRight(limit);
  }

  return db
    .get(channel_message_path(channel))
    .set(type, messages_of_type.value())
    .write();
};

exports.add_pr = pr => {
  const { channel } = pr;

  if (!exports.has_channel(channel)) {
    exports.create_channel(channel);
  }

  return db
    .get(pr_path(channel), [])
    .push(pr.to_json())
    .write();
};

exports.update_pr = pr => {
  const { channel } = pr;

  return db
    .get(pr_path(channel), [])
    .find({ slug: pr.slug })
    .assign(pr.to_json())
    .write();
};

exports.remove_pr = pr => {
  const { channel, slug } = pr;
  return db
    .get(pr_path(channel), [])
    .remove({ slug })
    .write();
};

exports.remove_pr_by_timestamp = (channel, ts) => {
  return db
    .get(pr_path(channel), [])
    .remove({ ts })
    .write();
};

exports.has_pr = (channel, slug) => {
  return db
    .get(pr_path(channel), [])
    .some({ slug })
    .value();
};

exports.get_user_by_github_user = github_user => {
  return db
    .get('users')
    .values()
    .find({ github_user })
    .value();
};

exports.get_channels = () => db.get('channels').value();
exports.get_users = () => db.get('users').value();
