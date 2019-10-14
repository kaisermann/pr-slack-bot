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

module.exports = async ({ channel, ts, thread_ts, user_id, params }) => {
  const pr = channel.prs.find(pr => pr.ts === thread_ts);

  if (pr == null) return;

  await pr.reply(`roulette_${ts}`, `:think-360:`);

  let members;
  if (params) {
    const mentioned_group_match = params.match(/<!subteam\^(.*?)\|.*?>/i);
    if (mentioned_group_match) {
      members = await Slack.get_user_group_members(mentioned_group_match[1]);
    } else {
      const group_name = params;
      members = DB.users
        .get('groups')
        .find({ handle: group_name })
        .get('users', [])
        .value();
    }
  } else {
    members = await Slack.get_channel_members(channel.id);
  }

  members = members.filter(id => id !== user_id && id !== pr.poster_id);

  let chosen_member;
  let retry_count = -1;

  await pr.reply(`roulette_${ts}`, `:thinking-face-fast:`);

  do {
    if (retry_count++ >= 20) {
      Logger.error(
        { channel, ts, thread_ts },
        'Max members shuffling attempts reached',
      );
      chosen_member = null;
      break;
    }

    chosen_member = DB.users.get(['members', get_random_item(members)]).value();
  } while (!chosen_member);

  const text = chosen_member
    ? `:${get_random_item(possible_emojis)}: <@${chosen_member.id}>`
    : `For some reason I couldn't choose a random channel member... :sob:`;

  await pr.reply(`roulette_${ts}`, text, chosen_member);
  channel.save_pr(pr);
};
