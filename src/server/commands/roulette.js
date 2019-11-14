const get_random_item = require('../../includes/get_random_item.js');
const Message = require('../../includes/message.js');
const Logger = require('../../includes/logger.js');
const Slack = require('../../api/slack.js');
const DB = require('../../api/db.js');

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
  'bushes_uncertain',
];

module.exports = async ({ channel, ts, thread_ts, user_id, params }) => {
  const pr = channel.prs.find(pr => pr.ts === thread_ts);

  if (pr == null) return;

  await pr.reply(`roulette_${ts}`, `:think-360:`);

  let member_list;
  if (params) {
    const group_match = Message.match_group_mention(params);
    if (group_match) {
      member_list = await Slack.get_user_group_members(group_match[1]);
    } else {
      const group_name = params;
      member_list = DB.users
        .get('groups')
        .find({ handle: group_name })
        .get('users', [])
        .value();
    }
  } else {
    member_list = await Slack.get_channel_members(channel.id);
  }

  const member_set = new Set(member_list);
  member_set.delete(user_id);
  member_set.delete(pr.poster_id);

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

    chosen_member = DB.users
      .get(['members', get_random_item(member_set)])
      .value();

    Logger.log(`Roulette: ${JSON.stringify(chosen_member)}`);

    // do not mention people on vacation
    if (
      chosen_member &&
      chosen_member.status_text.match(/vacation|f[ée]rias/gi)
    ) {
      member_list.delete(chosen_member.id);
      chosen_member = null;
    }
  } while (!chosen_member);

  const text = chosen_member
    ? `:${get_random_item(possible_emojis)}: ${Message.get_user_mention(
        chosen_member.id,
      )}`
    : `For some reason I couldn't choose a random channel member... :sob:`;

  await pr.reply(`roulette_${ts}`, text, chosen_member);
  channel.save_pr(pr);
};
