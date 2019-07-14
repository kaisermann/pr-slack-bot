const DB = require('../api/db.js');
const edit_forgotten_prs = require('./update_forgotten_prs.js');

module.exports = async pr => {
  const { has_changed } = await pr.update();

  if (pr.state.merged || pr.state.closed) {
    await edit_forgotten_prs(pr);
    DB.remove_pr(pr);
    return;
  }

  if (!has_changed) {
    return;
  }

  DB.update_pr(pr);
};
