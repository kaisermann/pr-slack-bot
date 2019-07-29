require('dotenv/config');
const cron = require('node-cron');

const Slack = require('./api/slack.js');
const Logger = require('./api/logger.js');
const { PR_CHECK_LOOP_INTERVAL } = require('./consts.js');

const check_prs = require('./tasks/check_prs.js');
const check_forgotten_prs = require('./tasks/check_forgotten_prs.js');
const update_users = require('./tasks/update_users.js');

const runtime = require('./runtime.js');

const cron_options = {
  scheduled: true,
  timezone: 'America/Sao_Paulo',
};

runtime.init();

// check_prs();
async function check_loop() {
  await check_prs();
  setTimeout(check_loop, PR_CHECK_LOOP_INTERVAL);
}
check_loop();

// send forgotten prs message every work day at 14:00
// check_forgotten_prs();
cron.schedule('0 15 * * 1-5', check_forgotten_prs, cron_options);
cron.schedule('0 10 * * 1-5', check_forgotten_prs, cron_options);

// update user list every midnight
// update_users();
cron.schedule('0 0 * * 1-5', update_users, cron_options);

Slack.on_pr_message(
  // on new pr message
  async pr_data => {
    const { slug, channel: channel_id } = pr_data;

    const channel = await runtime.get_or_create_channel(channel_id);

    if (channel.has_pr(slug)) {
      Logger.log(`Overwriting PR message: ${slug}`);
      channel.set_pr(pr_data);
    } else {
      Logger.log(`Watching ${slug}`);
      channel.add_pr(pr_data);
    }
    channel.update_pr(pr_data);
  },
  // on pr message deleted
  ({ channel: channel_id, deleted_ts }) => {
    const channel = runtime.get_channel(channel_id);
    channel.remove_pr_by_timestamp(deleted_ts);
  },
);
