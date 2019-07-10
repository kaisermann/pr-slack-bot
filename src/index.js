require('dotenv').config();

const cron = require('node-cron');
const DB = require('./api/db.js');

const Slack = require('./api/slack.js');
const PR = require('./pr.js');

const check_prs = require('./tasks/check_prs.js');
const check_forgotten_prs = require('./tasks/check_forgotten_prs.js');
const update_pr = require('./tasks/update_pr_message.js');

check_prs();
cron.schedule('* * * * *', check_prs, {
  scheduled: true,
  timezone: 'America/Sao_Paulo',
});

// check_forgotten_prs();
cron.schedule('0 14 * * 1-5', check_forgotten_prs, {
  scheduled: true,
  timezone: 'America/Sao_Paulo',
});

Slack.on_pr_message(pr_meta => {
  const { slug } = pr_meta;

  if (DB.has_pr(slug)) {
    return console.log(`${slug} is already being watched`);
  }
  console.log(`Watching ${slug}`);

  const pr = PR.create(pr_meta);

  DB.add_pr(pr);
  update_pr(pr);
});
