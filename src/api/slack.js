const { RTMClient } = require('@slack/rtm-api');
const { WebClient, retryPolicies } = require('@slack/web-api');

const Balancer = require('../balancer.js');
const Logger = require('./logger.js');
const { PRIVATE_TEST_CHANNELS } = require('../consts.js');

const TOKEN = process.env.SLACK_TOKEN;
const RTM = new RTMClient(TOKEN);

const PR_REGEX = /github\.com\/([\w-.]*)?\/([\w-.]*?)\/pull\/(\d+)/i;

const web_client = new WebClient(TOKEN, {
  retryConfig: retryPolicies.rapidRetryPolicy,
});

exports.web_client = web_client;

exports.get_channel_info = channel_id => {
  return Balancer.Slack.request(
    () => {
      Logger.add_call('slack.conversations.info');
      return web_client.conversations
        .info({ channel: channel_id })
        .then(response => response.ok && response.channel)
        .catch(error => {
          console.log(error);
        });
    },
    channel_id,
    'get_channel_info',
  );
};

exports.get_user_info = id => {
  return Balancer.Slack.request(
    () => {
      Logger.add_call('slack.users.info');
      return web_client.users
        .info({ user: id })
        .then(response => response.ok && response.user)
        .catch(error => {
          console.log(error);
        });
    },
    id,
    'get_user_info',
  );
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

      const is_deleted_message =
        subtype === 'message_deleted' ||
        (subtype === 'message_changed' && e.message.subtype === 'tombstone');
      const is_edited_message =
        subtype === 'message_changed' && !is_deleted_message;

      if (is_deleted_message) {
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

        pr_message = e.message ? e.message.text : null;
        ts = e.message.ts;
      }

      if (!pr_message && e.attachments.length) {
        const { title_link, pretext } = e.attachments[0];
        if (pretext.match(/pull request opened/i)) {
          pr_message = title_link;
        }
      }

      if (!pr_message) return;

      const match = pr_message.match(PR_REGEX);
      if (!match) return;

      const [, owner, repo, pr_id] = match;

      on_new_message({
        poster_id: e.user || (e.message ? e.message.user : null),
        slug: `${owner}/${repo}/${pr_id}`,
        owner,
        repo,
        pr_id,
        ts,
        channel,
      });
    } catch (error) {
      Logger.log_error(error);
    }
  });

  await RTM.start();
};

exports.send_message = (text, channel, thread_ts) => {
  return Balancer.Slack.request(
    () => {
      Logger.add_call('slack.chat.postMessage');
      return web_client.chat.postMessage({
        text,
        channel,
        thread_ts,
        unfurl_links: false,
        // send as paulo ricardo
        as_user: true,
        link_names: true,
      });
    },
    channel + thread_ts,
    'send_message',
  );
};

exports.update_message = ({ channel, ts }, newText) => {
  return Balancer.Slack.request(
    () => {
      Logger.add_call('slack.chat.update');
      return web_client.chat.update({
        text: newText,
        channel,
        ts,
        unfurl_links: false,
        as_user: true,
        link_names: true,
      });
    },
    channel + ts,
    'update_message',
  );
};

exports.delete_message = ({ channel, ts }) => {
  return Balancer.Slack.request(
    () => {
      Logger.add_call('slack.chat.delete');
      return web_client.chat.delete({
        channel,
        ts,
      });
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
  const response = await web_client.chat.getPermalink({
    channel,
    message_ts: ts,
  });

  return response.permalink.replace(/\?.*$/, '');
};
