require('dotenv').config();

const cron = require('node-cron');
const DB = require('./api/db.js');

const Slack = require('./api/slack.js');
const PR = require('./pr.js');

const check_PRs = require('./tasks/check_PRs.js');
const check_ignored_PRs = require('./tasks/check_ignored_PRs.js');
const update_PR = require('./tasks/update_PR.js');

check_PRs();
cron.schedule('* * * * *', check_PRs, {
  scheduled: true,
  timezone: 'America/Sao_Paulo',
});

// check_ignored_PRs();
cron.schedule('0 14 * * 1-5', check_ignored_PRs, {
  scheduled: true,
  timezone: 'America/Sao_Paulo',
});

Slack.onPRMessage(prMeta => {
  const { slug } = prMeta;

  if (DB.hasPR(slug)) {
    return console.log(`${slug} is already being watched`);
  }
  console.log(`Watching ${slug}`);

  const pr = PR.create(prMeta);

  DB.setPR(pr);
  update_PR(pr);
});
