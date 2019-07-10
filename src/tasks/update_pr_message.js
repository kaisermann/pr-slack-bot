const DB = require('../api/db.js');
const edit_forgotten_prs = require('./update_forgotton_prs.js');

module.exports = async function update_pr(pr) {
  const { has_changed } = await pr.update_status();

  if (!has_changed) {
    return;
  }

  if (pr.state.merged || pr.state.closed) {
    edit_forgotten_prs(pr);
    DB.remove_pr(pr);
  } else {
    DB.add_pr(pr);
  }
};
