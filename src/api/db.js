const { produce } = require('immer');
const low = require('lowdb');
const FileSyncAdapter = require('lowdb/adapters/FileSync');
const PR = require('../pr.js');

const db = low(new FileSyncAdapter('db.json'));

db.defaults({
  messages_sent: {},
  prs: {},
}).write();

let cached_prs = null;

exports.get_messages = type => {
  if (type == null) {
    return db.get('messages_sent').value();
  }

  return db
    .defaultsDeep({ messages_sent: { [type]: [] } })
    .get('messages_sent')
    .get(type)
    .value();
};

exports.remove_message = message => {
  const { type } = message;
  db.defaultsDeep({
    messages_sent: { [type]: [] },
  })
    .get([`messages_sent`, type])
    .remove({ ts: message.ts, channel: message.channel })
    .write();
};

exports.update_message = (message, fn) => {
  const { type } = message;
  db.defaultsDeep({
    messages_sent: { [type]: [] },
  })
    .get([`messages_sent`, type])
    .find({ ts: message.ts, channel: message.channel })
    .assign(produce(message, fn))
    .write();
};

exports.save_message = (message, limit) => {
  const { type } = message;
  let messages_of_type = db
    .defaultsDeep({
      messages_sent: { [type]: [] },
    })
    .get('messages_sent')
    .get(type)
    .push(message);

  if (typeof limit === 'number') {
    messages_of_type = messages_of_type.takeRight(limit);
  }

  db.get('messages_sent')
    .set(type, messages_of_type.value())
    .write();
};

exports.add_pr = pr => {
  cached_prs = null;

  db.get('prs')
    .set(pr.slug, pr.to_json())
    .write();
};

exports.remove_pr = pr => {
  cached_prs = null;

  db.get('prs')
    .unset(pr.slug)
    .write();
};

exports.has_pr = slug =>
  db
    .get('prs')
    .has(slug)
    .value();

exports.get_prs = () => {
  if (cached_prs == null) {
    cached_prs = db
      .get('prs')
      .values()
      .map(PR.create)
      .value();
  }

  return cached_prs;
};
