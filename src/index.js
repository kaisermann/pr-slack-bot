require('dotenv/config');
const cron = require('node-cron');

const DB = require('./api/db.js');
const Slack = require('./api/slack.js');
const Logger = require('./api/logger.js');
const PR = require('./pr.js');
const { PR_CHECKS_PER_MINUTE } = require('./consts.js');

const check_prs = require('./tasks/check_prs.js');
const check_forgotten_prs = require('./tasks/check_forgotten_prs.js');
const update_users = require('./tasks/update_users.js');
const update_pr = require('./tasks/update_pr_message.js');

const cron_options = {
  scheduled: true,
  timezone: 'America/Sao_Paulo',
};

check_prs();
setInterval(check_prs, (60 / PR_CHECKS_PER_MINUTE) * 1000);

// send forgotten prs message every work day at 14:00
// check_forgotten_prs();
cron.schedule('0 14 * * 1-5', check_forgotten_prs, cron_options);

// update user list every midnight
// update_users();
cron.schedule('0 0 * * 1-5', update_users, cron_options);

Slack.on_pr_message(
  // on new pr message
  pr_meta => {
    const { slug, channel } = pr_meta;

    if (DB.has_pr(channel, slug)) {
      return Logger.log(`${slug} is already being watched`);
    }
    Logger.log(`Watching ${slug}`);

    const pr = PR.create(pr_meta);

    DB.add_pr(pr);
    update_pr(pr);
  },
  // on pr message deleted
  ({ channel, deleted_ts }) => {
    DB.remove_pr_by_timestamp(channel, deleted_ts);
  },
);
