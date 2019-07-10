const DB = require('../api/db.js');
const edit_forgotten_prs = require('./update_forgotten_prs.js');

module.exports = async function update_pr(pr) {
  const { has_changed } = await pr.update_status();

  if (pr.state.merged || pr.state.closed) {
    edit_forgotten_prs(pr);
    DB.unset_pr(pr);
    return;
  }

  if (!has_changed) {
    return;
  }

  DB.set_pr(pr);
};
