const { WebClient } = require('@slack/web-api');
const { RTMClient } = require('@slack/rtm-api');

require('dotenv').config();

const EMOJIS = {
  approved: 'white_check_mark',
  commented: 'speech_balloon',
  merged: 'merged',
  changes: 'changes',
};

const token = process.env.SLACK_TOKEN;

const RTM = new RTMClient(token);
const WEB = new WebClient(token);

const PR_REGEX = /github\.com\/(?:[\w-]*?\/){2}pull\/(\d+)/i;

const addEmojiReaction = (emoji, channel, timestamp) => {
  return WEB.reactions.add({ name: emoji, channel, timestamp });
};

RTM.on('message', e => {
  const { thread_ts, subtype, text, channel, event_ts } = e;
  if (thread_ts != null || subtype != null) return;

  const match = text.match(PR_REGEX);

  if (match) {
    addEmojiReaction(EMOJIS.approved, channel, event_ts);
    addEmojiReaction(EMOJIS.merged, channel, event_ts);
  } else {
    addEmojiReaction('thumbsdown', channel, event_ts);
  }
});

(async () => {
  await RTM.start();
})();
