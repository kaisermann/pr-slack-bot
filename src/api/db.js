const { produce } = require('immer');
const low = require('lowdb');
const FileSyncAdapter = require('lowdb/adapters/FileSync');
const PR = require('../pr.js');

const db = low(new FileSyncAdapter('db.json'));

db.defaults({
  users: [],
  channels: {},
}).write();

const get_sent_messages_path = (channel, type) =>
  ['channels', channel, 'messages', type].filter(Boolean);

const get_pr_path = channel => ['channels', channel, 'prs'];

exports.client = db;

exports.get_channel_list = () =>
  db
    .get('channels')
    .keys()
    .value();

exports.get_channel_prs = channel => {
  return db
    .get(get_pr_path(channel))
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
      id: channel,
      prs: [],
      messages: {},
    })
    .write();
};

exports.get_messages = (channel, type) => {
  return db.get(get_sent_messages_path(channel, type), []).value();
};

exports.remove_message = message => {
  const { channel, ts, type } = message;
  db.get(get_sent_messages_path(channel, type), [])
    .remove({ ts, channel })
    .write();
};

exports.update_message = (message, fn) => {
  const { type, channel, ts } = message;
  db.get(get_sent_messages_path(channel, type))
    .find({ ts, channel })
    .assign(produce(message, fn))
    .write();
};

exports.save_message = (message, limit) => {
  const { type, channel } = message;
  let messages_of_type = db
    .get(get_sent_messages_path(channel, type), [])
    .push(message);

  if (typeof limit === 'number') {
    messages_of_type = messages_of_type.takeRight(limit);
  }

  return db
    .get(get_sent_messages_path(channel))
    .set(type, messages_of_type.value())
    .write();
};

exports.add_pr = pr => {
  const { channel } = pr;

  if (!exports.has_channel(channel)) {
    exports.create_channel(channel);
  }

  return db
    .get(get_pr_path(channel), [])
    .push(pr.to_json())
    .write();
};

exports.update_pr = pr => {
  const { channel } = pr;

  return db
    .get(get_pr_path(channel), [])
    .find({ slug: pr.slug })
    .assign(pr.to_json())
    .write();
};

exports.remove_pr = pr => {
  const { channel, slug } = pr;
  return db
    .get(get_pr_path(channel), [])
    .remove({ slug })
    .write();
};

exports.remove_pr_by_timestamp = (channel, ts) => {
  return db
    .get(get_pr_path(channel), [])
    .remove({ ts })
    .write();
};

exports.has_pr = (channel, slug) => {
  return db
    .get(get_pr_path(channel), [])
    .some({ slug })
    .value();
};

exports.get_user_by_github_username = github_username => {
  return db
    .get('users')
    .find({ github_username })
    .value();
};
