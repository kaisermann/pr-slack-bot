const { RTMClient } = require('@slack/rtm-api');
const { WebClient, retryPolicies } = require('@slack/web-api');

const Metrics = require('./metrics.js');
const { PRIVATE_TEST_CHANNEL } = require('../consts.js');

const TOKEN = process.env.SLACK_TOKEN;
const RTM = new RTMClient(TOKEN);

const PR_REGEX = /github\.com\/([\w-.]*)?\/([\w-.]*?)\/pull\/(\d+)/i;

const slack_web_client = new WebClient(TOKEN, {
  retryConfig: retryPolicies.rapidRetryPolicy,
});

exports.web_client = slack_web_client;

exports.on_pr_message = async onMessage => {
  RTM.on('message', e => {
    try {
      const { thread_ts, subtype, text } = e;

      // dont listen to messages not posted directly to a channel
      if (thread_ts != null || subtype != null) {
        return;
      }

      // production env should not listen to test channel
      if (
        process.env.NODE_ENV === 'production' &&
        e.channel === PRIVATE_TEST_CHANNEL
      ) {
        return;
      }

      // dev env should listen only to test channel
      if (
        process.env.NODE_ENV !== 'production' &&
        e.channel !== PRIVATE_TEST_CHANNEL
      ) {
        return;
      }

      let pr_message = text;
      if (text === '' && e.attachments.length) {
        const { title_link, pretext } = e.attachments[0];
        if (pretext.match(/pull request opened/i)) {
          pr_message = title_link;
        }
      }

      const match = pr_message.match(PR_REGEX);
      if (match) {
        const [, owner, repo, pr_id] = match;
        const slug = `${owner}/${repo}/${pr_id}`;
        onMessage({
          owner,
          repo,
          pr_id,
          slug,
          ts: e.event_ts,
          channel: e.channel,
        });
      }
    } catch (error) {
      console.log(error);
    }
  });

  await RTM.start();
};

exports.send_message = (text, channel, thread_ts) => {
  Metrics.add_call('slack.chat.postMessage');
  return slack_web_client.chat.postMessage({
    text,
    channel,
    thread_ts,
    unfurl_links: false,
    // send as paulo ricardo
    as_user: true,
  });
};

exports.updateMessage = ({ channel, ts }, newText) => {
  Metrics.add_call('slack.chat.update');
  return slack_web_client.chat.update({
    text: newText,
    channel,
    ts,
    unfurl_links: false,
    as_user: true,
  });
};
