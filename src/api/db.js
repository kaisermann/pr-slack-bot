const { produce } = require('immer');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const PR = require('../pr.js');

const adapter = new FileSync('db.json');
const db = low(adapter);

db.defaults({
  messages_sent: {},
  prs: {},
}).write();

let cachedPRs = null;

exports.getMessages = type => {
  if (type == null) {
    return db.get('messages_sent').value();
  }

  return db
    .defaultsDeep({ messages_sent: { [type]: [] } })
    .get('messages_sent')
    .get(type)
    .value();
};

exports.removeMessage = message => {
  const { type } = message;
  db.defaultsDeep({
    messages_sent: { [type]: [] },
  })
    .get([`messages_sent`, type])
    .remove({ ts: message.ts, channel: message.channel })
    .write();
};

exports.updateMessage = (message, fn) => {
  const { type } = message;
  db.defaultsDeep({
    messages_sent: { [type]: [] },
  })
    .get([`messages_sent`, type])
    .find({ ts: message.ts, channel: message.channel })
    .assign(produce(message, fn))
    .write();
};

exports.saveMessage = (message, limit) => {
  const { type } = message;
  let saved_messages_of_type = db
    .defaultsDeep({
      messages_sent: { [type]: [] },
    })
    .get('messages_sent')
    .get(type)
    .push(message);

  if (typeof limit === 'number') {
    saved_messages_of_type = saved_messages_of_type.takeRight(limit);
  }

  db.get('messages_sent')
    .set(type, saved_messages_of_type.value())
    .write();
};

exports.setPR = pr => {
  cachedPRs = null;

  db.get('prs')
    .set(pr.slug, pr.toJSON())
    .write();
};

exports.unsetPR = pr => {
  cachedPRs = null;

  db.get('prs')
    .unset(pr.slug)
    .write();
};

exports.hasPR = slug =>
  db
    .get('prs')
    .has(slug)
    .value();

exports.getPRs = () => {
  if (cachedPRs == null) {
    cachedPRs = db
      .get('prs')
      .values()
      .map(PR.create)
      .value();
  }

  return cachedPRs;
};
