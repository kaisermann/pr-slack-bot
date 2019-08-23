const low = require('lowdb');
const FileSyncAdapter = require('lowdb/adapters/FileSync');

// todo transform into file async
const channels = low(new FileSyncAdapter('./db/channels.json'));

const installations = low(new FileSyncAdapter('./db/installations.json'));

installations.get_id = name => installations.get(name).value();
installations.set_id = (name, id) => installations.set([name], id).write();
installations.unset_id = name => installations.unset([name]).write();

const users = low(new FileSyncAdapter('./db/users.json'));
users.get_by_github_user = github_user => {
  return users
    .values()
    .find({ github_user })
    .value();
};

exports.channels = channels;
exports.users = users;
exports.installations = installations;
