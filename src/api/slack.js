const { RTMClient } = require('@slack/rtm-api');
const { WebClient, retryPolicies } = require('@slack/web-api');

const Balancer = require('./balancer.js');
const Logger = require('./logger.js');
const { PRIVATE_TEST_CHANNELS } = require('../consts.js');

const TOKEN = process.env.SLACK_TOKEN;
const RTM = new RTMClient(TOKEN);

const PR_REGEX = /github\.com\/([\w-.]*)?\/([\w-.]*?)\/pull\/(\d+)/i;

const web_client = new WebClient(TOKEN, {
  retryConfig: retryPolicies.rapidRetryPolicy,
});

exports.web_client = web_client;

exports.get_user_info = id => {
  return Balancer.request(
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
      const { thread_ts, subtype, text } = e;

      // dont listen to messages not posted directly to a channel
      if (
        thread_ts != null ||
        (subtype != null && subtype !== 'message_deleted')
      ) {
        return;
      }

      // production env should not listen to test channel
      if (
        process.env.NODE_ENV === 'production' &&
        PRIVATE_TEST_CHANNELS.includes(e.channel)
      ) {
        return;
      }

      // dev env should listen only to test channel
      if (
        process.env.NODE_ENV !== 'production' &&
        !PRIVATE_TEST_CHANNELS.includes(e.channel)
      ) {
        return;
      }

      let pr_message = text;

      if (subtype === 'message_deleted') {
        pr_message = e.previous_message.text;
      }

      if (pr_message === '' && e.attachments.length) {
        const { title_link, pretext } = e.attachments[0];
        if (pretext.match(/pull request opened/i)) {
          pr_message = title_link;
        }
      }

      const match = pr_message.match(PR_REGEX);
      if (!match) {
        return;
      }

      if (subtype === 'message_deleted') {
        return on_message_deleted({
          channel: e.channel,
          deleted_ts: e.deleted_ts,
        });
      }

      const [, owner, repo, pr_id] = match;
      const slug = `${owner}/${repo}/${pr_id}`;

      on_new_message({
        owner,
        repo,
        pr_id,
        slug,
        ts: e.event_ts,
        channel: e.channel,
      });
    } catch (error) {
      Logger.log_error(error);
    }
  });

  await RTM.start();
};

exports.send_message = (text, channel, thread_ts) => {
  return Balancer.request(
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
  return Balancer.request(
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

exports.get_message_url = async (channel, ts) => {
  Logger.add_call('slack.chat.getPermalink');
  const response = await web_client.chat.getPermalink({
    channel,
    message_ts: ts,
  });

  return response.permalink.replace(/\?.*$/, '');
};
