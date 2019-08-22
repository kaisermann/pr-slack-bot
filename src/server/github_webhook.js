const R = require('ramda');
const db = require('../api/db.js');
const runtime = require('../runtime.js');
const Logger = require('../includes/logger.js');

const update_prs = async prs => {
  if (prs.length === 0) return;

  return Promise.all(
    prs.map(async pr => {
      const channel = runtime.get_channel(pr.channel);
      return pr.update().then(channel.on_pr_updated);
    }),
  );
};

function on_installation({ req }) {
  const {
    installation,
    repositories_removed: removed,
    repositories_added: added,
  } = req.body;

  if (removed) {
    removed.forEach(repo => db.installations.unset_id(repo.full_name));
  }

  if (added) {
    added.forEach(repo =>
      db.installations.set_id(repo.full_name, installation.id),
    );
    const added_map = R.groupBy(R.prop('full_name'), added);
    const related_prs = runtime.prs.filter(
      pr => `${pr.owner}/${pr.repo}` in added_map,
    );

    return update_prs(related_prs);
  }
  return;
}

async function on_pull_request_change({ event, req }) {
  const { action, repository } = req.body;
  let pull_request = req.body.pull_request;
  if (event === 'check_suite') {
    pull_request = req.body.check_suite.pull_requests[0];
  }

  if (!pull_request) {
    throw `Couldn't find a Pull Request for "${event}/${action}"`;
  }

  const pr_slug = `${repository.full_name}/${pull_request.number}`;
  Logger.success(`Triggered "${event}/${action}" on "${pr_slug}"`);

  const pr = runtime.prs.find(pr => pr.slug === pr_slug);
  if (pr == null) return;

  const channel = runtime.get_channel(pr.channel);
  return pr.update().then(channel.on_pr_updated);
}

async function on_push({ req }) {
  const { ref, repository } = req.body;
  const branch = ref.split('/').pop();

  const related_prs = runtime.prs.filter(
    pr =>
      pr.repo === repository.name &&
      pr.owner === repository.owner.name &&
      pr.state.base_branch === branch,
  );

  if (related_prs.length) {
    Logger.success(
      `Triggered "push" on "${repository.owner.name}/${
        repository.name
      }": ${related_prs.map(pr => pr.pr_id).join(', ')}`,
    );
  }

  return update_prs(related_prs);
}

exports.parse_github_webhook = async (req, res) => {
  const event = req.headers['x-github-event'];

  res.statusCode = 200;
  res.end('ok');

  if (event === 'installation_repositories') {
    return on_installation({ event, req, res });
  }

  if (
    event === 'pull_request' ||
    event === 'pull_request_review' ||
    event === 'check_suite'
  ) {
    return on_pull_request_change({ event, req, res });
  }

  if (event === 'push') {
    return on_push({ event, req, res });
  }

  // if (process.env.NODE_ENV !== 'production') {
  Logger.warn(`Ignoring event: "${event}/${req.body.action}"`);
  // }
};
