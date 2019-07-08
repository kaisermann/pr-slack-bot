const { RTMClient } = require('@slack/rtm-api');
const { WebClient, retryPolicies } = require('@slack/web-api');
const Metrics = require('./metrics.js');

const TOKEN = process.env.SLACK_TOKEN;
const RTM = new RTMClient(TOKEN);

const PRIVATE_TEST_CHANNEL = 'GKSCG1GRX';

const PR_REGEX = /github\.com\/([\w-.]*)?\/([\w-.]*?)\/pull\/(\d+)/i;

const SlackWebClient = new WebClient(TOKEN, {
  retryConfig: retryPolicies.rapidRetryPolicy,
});

exports.WebClient = SlackWebClient;

exports.onPRMessage = async onMessage => {
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
        process.env.NODE_ENV === 'development' &&
        e.channel !== PRIVATE_TEST_CHANNEL
      ) {
        return;
      }

      let prMessage = text;
      if (text === '' && e.attachments.length) {
        const { title_link, pretext } = e.attachments[0];
        if (pretext.match(/pull request opened/i)) {
          prMessage = title_link;
        }
      }

      const match = prMessage.match(PR_REGEX);
      if (match) {
        const [, owner, repo, prID] = match;
        const slug = `${owner}/${repo}/${prID}`;
        onMessage({
          owner,
          repo,
          prID,
          slug,
          timestamp: e.event_ts,
          channel: e.channel,
        });
      }
    } catch (error) {
      console.log(error);
    }
  });

  await RTM.start();
};

exports.sendMessage = (text, channel, thread_ts) => {
  Metrics.addCall('slack.chat.postMessage');
  return SlackWebClient.chat.postMessage({
    text,
    channel,
    thread_ts,
    unfurl_links: false,
    // send as paulo ricardo
    as_user: true,
  });
};
