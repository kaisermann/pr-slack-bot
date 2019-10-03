const Logger = require('../../includes/logger.js');
const Slack = require('../../api/slack.js');
const DB = require('../../api/db.js');

const get_random_item = arr => arr[Math.floor(Math.random() * arr.length)];

const possible_emojis = [
  'awthanks',
  'gun',
  'eyes',
  'pray',
  'eyes-inside',
  'drake-yes',
  'doge2',
  'harold-pain',
  'this-is-fine-fire',
  'flushed-cross-eye-transparent',
  'developers',
  'eyesright',
  'mutley_laugh',
  'mini-hangloose',
  'pokebola',
  'call_me_hand',
];

module.exports = async ({ channel, ts, thread_ts }) => {
  const pr = channel.prs.find(pr => pr.ts === thread_ts);
  await pr.reply(`roulette_${ts}`, `:think-360:`);

  const members = await Slack.get_channel_members(channel.id);
  let chosen_member;
  let retry_count = -1;

  await pr.reply(`roulette_${ts}`, `:thinking-face-fast:`);

  do {
    if (retry_count++ >= 20) {
      Logger.error(
        { channel, ts, thread_ts },
        'Max members shuffling attempts reached',
      );
      break;
    }
    chosen_member = DB.users.get(get_random_item(members)).value();
  } while (!chosen_member);

  const text = `:${get_random_item(possible_emojis)}: <@${chosen_member.id}>`;
  if (pr) {
    await pr.reply(`roulette_${ts}`, text, chosen_member);
    channel.save_pr(pr);
  }
};
