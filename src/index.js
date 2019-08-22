require('dotenv/config');
const cron = require('node-cron');

const Slack = require('./api/slack.js');
const check_forgotten_prs = require('./includes/check_forgotten_prs.js');
const update_users = require('./includes/update_users.js');
const runtime = require('./runtime.js');
const server = require('./server/index.js');
const Logger = require('./includes/logger.js');

const CRON_OPTS = { scheduled: true, timezone: 'America/Sao_Paulo' };

async function boot() {
  const { channels } = runtime;
  // initialize all prs before starting server
  await Promise.all(channels.map(channel => channel.update()));

  // start the web server
  server.start();

  // send forgotten prs message every work day at 14:00
  // check_forgotten_prs();
  cron.schedule('0 15 * * 1-5', check_forgotten_prs, CRON_OPTS);
  cron.schedule('0 10 * * 1-5', check_forgotten_prs, CRON_OPTS);

  // update user list every midnight
  // update_users();
  cron.schedule('0 0 * * 1-5', update_users, CRON_OPTS);

  Slack.on_pr_message(
    // on new pr message
    async pr_data => {
      const { slug, channel: channel_id } = pr_data;

      const channel = await runtime.get_or_create_channel(channel_id);

      let pr;
      if (channel.has_pr(slug)) {
        Logger.info(`Overwriting PR message: ${slug}`);
        pr = channel.replace_pr(pr_data.slug, pr_data);
      } else {
        Logger.info(`Watching ${slug}`);
        pr = channel.add_pr(pr_data);
      }
      pr.update().then(channel.on_pr_updated);
    },
    // on pr message deleted
    ({ channel: channel_id, deleted_ts }) => {
      const channel = runtime.get_channel(channel_id);
      channel.remove_pr_by_timestamp(deleted_ts);
    },
  );
}

boot();
