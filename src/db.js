const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const PR = require('./pr.js');

const adapter = new FileSync('db.json');
const db = low(adapter);

db.defaults({ prs: {} }).write();

let cachedPRs = null;

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
  } else {
    console.log('Using cache');
  }
  return cachedPRs;
};
