const { RTMClient } = require('@slack/rtm-api');
const { WebClient, retryPolicies } = require('@slack/web-api');
const Metrics = require('./metrics.js');

const TOKEN = process.env.SLACK_TOKEN;
const RTM = new RTMClient(TOKEN);

const PRIVATE_TEST_CHANNEL = 'GKSCG1GRX';

const PR_REGEX = /github\.com\/([\w-]*)?\/([\w-]*?)\/pull\/(\d+)/i;

const SlackWebClient = new WebClient(TOKEN, {
  retryConfig: retryPolicies.rapidRetryPolicy,
});
exports.SlackWebClient = SlackWebClient;

exports.onPRMessage = async onMessage => {
  RTM.on('message', e => {
    try {
      const { thread_ts, subtype, text } = e;
      // we just want channel messages
      if (
        thread_ts != null ||
        subtype != null ||
        (process.env.NODE_ENV === 'production' &&
          e.channel === PRIVATE_TEST_CHANNEL) ||
        (process.env.NODE_ENV === 'development' &&
          e.channel !== PRIVATE_TEST_CHANNEL)
      ) {
        return;
      }

      let prMessage = text;
      if (text === '' && e.attachments.length) {
        prMessage = e.attachments[0].title_link;
      }

      const match = prMessage.match(PR_REGEX);
      if (match) {
        const [, user, repo, prID] = match;
        const slug = `${user}/${repo}/${prID}`;
        onMessage({
          user,
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
  SlackWebClient.chat.postMessage({
    text,
    channel,
    thread_ts,
    unfurl_links: false,
    // send as paulo ricardo
    as_user: true,
  });
};
