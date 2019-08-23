const DB = require('./api/db.js');
const PR = require('./pr.js');
const Logger = require('./includes/logger.js');

exports.factory = ({ owner, name, prs = {} }) => {
  let full_name = `${owner}/${name}`;
  let id = full_name;
  let self;

  prs = Object.fromEntries(
    Object.entries(prs).map(([number, data]) => [number, PR.factory(data)]),
  );

  function find_prs(filter_fn) {
    return Object.values(prs).filter(filter_fn);
  }

  function get_pr(pr_number) {
    return prs[pr_number];
  }

  function has_pr(pr_number) {
    return pr_number in prs;
  }

  function set_pr(pr_data) {
    const { slug, number, channel_id, ts } = pr_data;
    let pr = get_pr(number);
    if (pr) {
      Logger.success(`Replacing "${slug}" thread message`);
      pr.change_thread_ts(channel_id, ts);
    } else {
      Logger.success(`Watching ${slug}`);
      pr = PR.factory(pr_data);
      prs[pr.number] = pr;
    }

    return save_pr(pr);
  }

  function save_pr(pr) {
    DB.repos.set([id, 'prs', pr.number], pr.to_json()).write();
    return pr;
  }

  function remove_pr(pr) {
    pr.invalidate_etag_signature();
    DB.repos.unset([id, 'prs', pr.number]).write();
    delete prs[pr.number];
  }

  function get_active_prs() {
    return find_prs(pr => pr.is_active());
  }

  function update_prs() {
    Logger.info(`# Updating all PRs from: ${id}`);
    return Promise.all(get_active_prs().map(async pr => pr.update()));
  }

  async function after_pr_update(pr) {
    if (!pr.is_resolved()) {
      return save_pr(pr);
    }

    remove_pr(pr);
  }

  function to_json() {
    return {
      owner,
      name,
      prs: Object.fromEntries(
        Object.entries(prs).map(([number, pr]) => [number, pr.to_json()]),
      ),
    };
  }

  // function save() {
  //   return DB.repos.set(id, to_json()).write();
  // }

  self = Object.freeze({
    owner,
    name,
    full_name: id,
    get prs() {
      return prs;
    },
    find_prs,
    get_pr,
    has_pr,
    set_pr,
    remove_pr,
    update_prs,
    after_pr_update,
    to_json,
    // save,
  });

  return self;
};

exports.create_new = full_name => {
  const [owner, name] = full_name.split('/');
  const repo = exports.factory({
    owner,
    name,
    prs: {},
  });

  return repo;
};
