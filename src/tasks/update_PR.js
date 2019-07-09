const DB = require('../api/db.js');
const edit_ignored_PRs = require('./edit_ignored_PRs.js');

module.exports = async function check(pr) {
  const { hasChanged } = await pr.update();

  if (!hasChanged) {
    return;
  }

  if (pr.state.merged || pr.state.closed) {
    edit_ignored_PRs(pr);
    DB.unsetPR(pr);
  } else {
    DB.setPR(pr);
  }
};
