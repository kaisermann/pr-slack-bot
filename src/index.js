require('dotenv/config');
const cron = require('node-cron');

const DB = require('./api/db.js');
const Slack = require('./api/slack.js');

const check_forgotten_prs = require('./includes/check_forgotten_prs.js');
const update_users = require('./includes/update_users.js');

const server = require('./server/index.js');

const runtime = require('./runtime.js');
const Repo = require('./repo.js');
const Channel = require('./channel.js');

const CRON_OPTS = { scheduled: true, timezone: 'America/Sao_Paulo' };

async function boot() {
  await runtime.init(() => {
    const channels = Object.fromEntries(
      DB.channels
        .entries()
        .value()
        .map(([id, data]) => [id, Channel.factory(data)]),
    );
    const users = DB.users.value();
    const repos = Object.fromEntries(
      DB.repos
        .entries()
        .value()
        .map(([id, data]) => [id, Repo.factory(data)]),
    );

    return { channels, users, repos };
  });

  // initialize all prs before starting server
  await Promise.all(
    Object.values(runtime.repos).map(repo => repo.update_prs()),
  );

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
      const { owner, repo: repo_name, channel_id } = pr_data;
      const full_name = `${owner}/${repo_name}`;

      let repo = runtime.get_repo(full_name);
      let channel = runtime.get_channel(channel_id);

      if (!repo) {
        repo = Repo.create_new(full_name);
        runtime.add_repo(repo);
      }

      if (!channel) {
        channel = await Channel.create_new(channel_id);
        runtime.add_channel(channel);
      }

      const pr = repo.set_pr(pr_data);
      channel.add_pr(pr);
      pr.update();
    },
    // on pr message deleted
    async ({ deleted_ts }) => {
      const pr = runtime.prs.find(({ ts }) => ts === deleted_ts);
      if (pr == null) return;

      const repo = runtime.get_repo(`${pr.owner}/${pr.repo}`);
      await pr.delete_replies();
      await repo.remove_pr(pr);
    },
  );
}

boot();
