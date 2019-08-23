const DB = require('./api/db.js');

let channels;
let users;
let repos;

module.exports = {
  async init(fn) {
    ({ channels, users, repos } = await fn());
  },
  get_repo(full_name) {
    return repos[full_name];
  },
  add_repo(repo) {
    repos[repo.full_name] = repo;
    DB.repos.set(repo.full_name, repo.to_json()).write();
    return repo;
  },
  get_channel(id) {
    return channels[id];
  },
  async add_channel(channel) {
    channels[channel.id] = channel;
    DB.channels.set(channel.id, channel.to_json()).write();
    return channel;
  },
  get channels() {
    return channels;
  },
  get users() {
    return users;
  },
  get repos() {
    return repos;
  },
  get prs() {
    return repos.flatMap(repo => Object.values(repo.prs));
  },
  get_pr(slug) {
    const [owner, name, number] = slug.split('/');
    const repo = this.get_repo(`${owner}/${name}`);

    if (!repo) return null;
    const pr = repo.get_pr(number);

    if (!pr) return null;
    return pr;
  },
};
