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

exports.client = db;

exports.transaction = (...parts) => {
  return parts
    .filter(Boolean)
    .reduce((acc, part) => part(acc), db)
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

exports.get_user_by_github_user = github_user => {
  return db
    .get('users')
    .values()
    .find({ github_user })
    .value();
};

exports.get_channels = () => db.get('channels').value();
exports.get_users = () => db.get('users').value();
