const db = require('../api/db.js');
const runtime = require('../runtime.js');
const Logger = require('../includes/logger.js');

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
    added.forEach(repository => {
      db.installations.set_id(repository.full_name, installation.id);

      const repo = runtime.get_repo(repository.full_name);
      if (!repo) return;
      repo.update_prs();
    });
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

  const repo = runtime.get_repo(repository.full_name);
  if (repo == null) return;

  const pr = repo.get_pr(pull_request.number);
  if (pr == null) return;

  Logger.success(
    `Triggered "${event}/${action}" on " ${repository.full_name}/${pull_request.number}"`,
  );

  pr.update();
}

async function on_push({ req }) {
  const { ref, repository } = req.body;
  const branch = ref.split('/').pop();

  const repo = runtime.get_repo(repository.full_name);
  if (repo == null) return;

  const related_prs = repo.find_prs(pr => pr.state.base_branch === branch);

  if (related_prs.length) {
    Logger.success(
      `Triggered "push" on "${repository.owner.name}/${
        repository.name
      }": ${related_prs.map(pr => pr.number).join(', ')}`,
    );
  }

  setTimeout(() => related_prs.map(pr => pr.update()), 800);
}

exports.parse_github_webhook = async (req, res) => {
  const event = req.headers['x-github-event'];
  const { action } = req.body;

  res.statusCode = 200;
  res.end('ok');

  if (event === 'installation_repositories') {
    return on_installation({ event, req, res });
  }

  if (
    event === 'pull_request' ||
    event === 'pull_request_review' ||
    event === 'pull_request_review_comment' ||
    event === 'check_suite'
  ) {
    return on_pull_request_change({ event, req, res });
  }

  if (event === 'push') {
    return on_push({ event, req, res });
  }

  // if (process.env.NODE_ENV !== 'production') {
  Logger.warn(`Ignoring event: "${event}/${action}"`);
  // }
};
