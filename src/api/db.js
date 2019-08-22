const low = require('lowdb');
const FileSyncAdapter = require('lowdb/adapters/FileSync');

// todo transform into file async
const db = low(new FileSyncAdapter('db.json'));
const installations = low(new FileSyncAdapter('installations.json'));

installations.get_id = name => installations.get(name).value();
installations.set_id = (name, id) => installations.set([name], id).write();
installations.unset_id = name => installations.unset([name]).write();

db.defaults({
  users: {},
  channels: {},
}).write();

exports.client = db;
exports.installations = installations;

exports.get_user_by_github_user = github_user => {
  return db
    .get('users')
    .values()
    .find({ github_user })
    .value();
};

exports.get_channels = () => db.get('channels').value();
exports.get_users = () => db.get('users').value();
