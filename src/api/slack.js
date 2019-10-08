const { RTMClient } = require('@slack/rtm-api');
const { WebClient, retryPolicies } = require('@slack/web-api');
const Queue = require('smart-request-balancer');
const memoize = require('memoizee');

const Logger = require('../includes/logger.js');
const DB = require('./db.js');
const { PRIVATE_TEST_CHANNELS } = require('../consts.js');

const { SLACK_BOT_TOKEN, SLACK_USER_TOKEN } = process.env;
const RTM = new RTMClient(SLACK_BOT_TOKEN);

const PR_REGEX = /github\.com\/([\w-.]*)?\/([\w-.]*?)\/pull\/(\d+)/i;
const PR_REGEX_GLOBAL = new RegExp(PR_REGEX.source, `${PR_REGEX.flags}g`);

const user_client = new WebClient(SLACK_USER_TOKEN, {
  retryConfig: retryPolicies.rapidRetryPolicy,
});
const bot_client = new WebClient(SLACK_BOT_TOKEN, {
  retryConfig: retryPolicies.rapidRetryPolicy,
});

const balancer = new Queue({
  rules: {
    common: {
      rate: 50,
      limit: 60,
      priority: 5,
    },
    send_message: {
      rate: 2,
      limit: 1,
      priority: 2,
    },
    get_profile_info: {
      rate: 500,
      limit: 60,
      priority: 10,
    },
    conversations_members: {
      rate: 500,
      limit: 60,
      priority: 10,
    },
  },
  retryTime: 300,
});

const memo_fetch_channel_members = memoize(
  (channel_id, cursor) => {
    return balancer.request(
      () => {
        Logger.add_call('slack.conversations.members');
        return bot_client.conversations
          .members({ channel: channel_id, cursor })
          .catch(error => {
            Logger.error(error);
          });
      },
      channel_id + cursor,
      'conversations_members',
    );
  },
  { maxAge: 1000 * 60 * 60, preFetch: true },
);

exports.bot_client = bot_client;
exports.user_client = user_client;

exports.get_channel_info = channel_id => {
  return balancer.request(
    () => {
      Logger.add_call('slack.conversations.info');
      return bot_client.conversations
        .info({ channel: channel_id })
        .then(response => response.ok && response.channel)
        .catch(error => {
          Logger.error(error);
        });
    },
    channel_id,
    'get_channel_info',
  );
};

exports.get_profile_info = id => {
  return balancer.request(
    () => {
      return user_client.users.profile
        .get({ user: id })
        .then(response => response.ok && response.profile)
        .catch(error => {
          Logger.error(error);
        });
    },
    id,
    'get_profile_info',
  );
};

exports.get_users = async function*() {
  const list_response = await bot_client.users.list();
  if (!list_response.ok) return;

  const active_users = list_response.members.filter(
    user => user.deleted !== true,
  );

  for await (let user of active_users) {
    const full_profile = await exports.get_profile_info(user.id);
    Object.assign(user.profile, full_profile);
    yield user;
  }
};

exports.get_channel_members = async channel_id => {
  let cursor;
  let channel_members = [];
  do {
    const response = await memo_fetch_channel_members(channel_id, cursor);
    if (!response || !response.ok) break;

    const {
      members,
      response_metadata: { next_cursor },
    } = response;

    cursor = next_cursor;
    channel_members.push(...members);
  } while (cursor !== '');

  return channel_members;
};

exports.on_pr_message = async (on_new_message, on_message_deleted) => {
  RTM.on('message', e => {
    try {
      const { thread_ts, channel, subtype } = e;

      // dont listen to messages not posted directly to a channel
      if (
        thread_ts != null ||
        (subtype != null &&
          subtype !== 'message_deleted' &&
          subtype !== 'message_changed')
      ) {
        return;
      }

      // production env should not listen to test channel
      if (
        process.env.NODE_ENV === 'production' &&
        PRIVATE_TEST_CHANNELS.includes(channel)
      ) {
        return;
      }

      // dev env should listen only to test channel
      if (
        process.env.NODE_ENV !== 'production' &&
        !PRIVATE_TEST_CHANNELS.includes(channel)
      ) {
        return;
      }

      let pr_message = e.text;
      let ts = e.event_ts;
      let poster_id = e.user || (e.message ? e.message.user : null);

      const is_deleted_message =
        subtype === 'message_deleted' ||
        (subtype === 'message_changed' && e.message.subtype === 'tombstone');
      const is_edited_message =
        subtype === 'message_changed' && !is_deleted_message;

      if (is_deleted_message) {
        // ignore if this is a event dispatched by the bot deleting a message
        if (
          'bot_id' in e.previous_message ||
          e.previous_message.subtype === 'tombstone'
        ) {
          return;
        }

        return on_message_deleted({
          channel,
          deleted_ts: e.deleted_ts || e.previous_message.ts,
        });
      }

      if (is_edited_message) {
        if (e.previous_message.text === e.message.text) return;

        const previous_match = e.previous_message.text.match(PR_REGEX);
        const current_match = e.message.text.match(PR_REGEX);

        if (previous_match != null && current_match == null) {
          return on_message_deleted({
            channel,
            deleted_ts: e.previous_message.ts,
          });
        }

        if (
          previous_match &&
          current_match &&
          previous_match[0] === current_match[0]
        ) {
          return;
        }

        pr_message = e.message ? e.message.text : null;
        ts = e.message.ts;
      }

      if (!pr_message && e.attachments.length) {
        const { title_link, pretext, author_name } = e.attachments[0];
        if (typeof pretext === 'string') {
          if (pretext.match(/pull request opened/i)) {
            pr_message = title_link;

            const user = DB.users.get_by_github_user(author_name);
            if (user) {
              poster_id = user.id;
            }
          }
        }
      }

      if (!pr_message) return;

      const matches = pr_message.match(PR_REGEX_GLOBAL);
      if (!matches || matches.length > 1) return;

      const match = pr_message.match(PR_REGEX);
      const [, owner, repo, pr_id] = match;

      on_new_message({
        poster_id,
        slug: `${owner}/${repo}/${pr_id}`,
        owner,
        repo,
        pr_id,
        ts,
        channel,
      });
    } catch (error) {
      Logger.error(error);
    }
  });

  await RTM.start();
};

exports.send_message = ({ text, blocks, channel, thread_ts }) => {
  return balancer.request(
    () => {
      Logger.add_call('slack.chat.postMessage');
      return bot_client.chat
        .postMessage({
          text,
          blocks,
          channel,
          thread_ts,
          unfurl_links: false,
          // send as paulo ricardo
          as_user: true,
          link_names: true,
        })
        .catch(e => e);
    },
    channel + thread_ts,
    'send_message',
  );
};

exports.update_message = ({ channel, ts, text, blocks }) => {
  return balancer.request(
    () => {
      Logger.add_call('slack.chat.update');
      return bot_client.chat
        .update({
          text,
          blocks,
          channel,
          ts,
          unfurl_links: false,
          as_user: true,
          link_names: true,
        })
        .catch(e => e);
    },
    channel + ts,
    'update_message',
  );
};

exports.delete_message = ({ channel, ts }) => {
  return balancer.request(
    () => {
      Logger.add_call('slack.chat.delete');
      return bot_client.chat
        .delete({
          channel,
          ts,
        })
        .catch(e => e);
    },
    channel + ts,
    'delete_message',
  );
};

exports.delete_message_by_url = url => {
  const match = url.match(
    /archives\/(.*?)\/p(.*?)(?:\/|#|$|\?.*?thread_ts=(.*?)(?:&|$)|\?)/i,
  );

  if (!match) return;

  let [, channel, ts] = match;

  ts = (+ts / 1000000).toFixed(6);

  exports.delete_message({ channel, ts });
};

exports.get_message_url = async (channel, ts) => {
  Logger.add_call('slack.chat.getPermalink');
  const response = await bot_client.chat.getPermalink({
    channel,
    message_ts: ts,
  });

  return response.permalink.replace(/\?.*$/, '');
};

exports.remove_reaction = (name, channel, ts) =>
  bot_client.reactions.remove({ name, timestamp: ts, channel });

exports.add_reaction = (name, channel, ts) =>
  bot_client.reactions.add({ name, timestamp: ts, channel });
