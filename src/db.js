const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync('db.json');
const db = low(adapter);

db.defaults({ prs: {} }).write();

exports.registerPR = ({ repo, ...meta }) => {
  db.get('prs')
    .set(meta.slug, meta)
    .write();
};

exports.updatePR = meta => {
  db.get('prs')
    .get(meta.slug)
    .map(() => meta)
    .write();
};

exports.unregisterPR = meta => {
  db.get('prs')
    .unset(meta.slug)
    .write();
};

exports.hasPR = slug =>
  db
    .get('prs')
    .has(slug)
    .value();

exports.getPRs = () =>
  db
    .get('prs')
    .values()
    .map(pr => ({
      bot_interactions: {},
      reactions: [],
      ...pr,
    }))
    .value();
