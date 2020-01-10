const get_random_item = require('../../includes/get_random_item.js');
const Message = require('../../includes/message.js');
const Logger = require('../../includes/logger.js');
const Slack = require('../../api/slack.js');
const DB = require('../../api/db.js');

const possible_emojis = [
  'worry-pls',
  'eyesright',
  'call_me_hand',
  'mini-hangloose',
  'awthanks',
  'gun',
  'pray',
  'eyes-inside',
  'pokebola',
  'drake-yes',
  'worry-mad',
  'mutley_laugh',
  'flushed-cross-eye-transparent',
  'eyes',
  'developers',
  'bushes_uncertain',
  'worry-glasses',
  'harold-pain',
  'this-is-fine-fire',
  'doge2',
  'worry-anime',
];

const wait = delay => new Promise(res => setTimeout(res, delay));

const get_member_list = async (channel, params) => {
  if (!params) {
    return Slack.get_channel_members(channel.id);
  }

  const group_match = Message.match_group_mention(params);
  if (group_match) {
    return Slack.get_user_group_members(group_match[1]);
  }

  const group_name = params;
  return DB.users
    .get('groups')
    .find({ handle: group_name })
    .get('users', [])
    .value();
};

module.exports = async ({ channel, ts, thread_ts, user_id, params }) => {
  const pr = channel.prs.find(pr => pr.ts === thread_ts);

  if (pr == null) return;

  // await pr.reply(`roulette_${ts}`, `:think-360:`);
  await pr.reply(`roulette_${ts}`, `:kuchiyose:`);

  const [member_list] = await Promise.all([
    get_member_list(channel, params),
    wait(1900),
  ]);

  const member_set = new Set(member_list);
  member_set.delete(user_id);
  member_set.delete(pr.poster_id);

  let chosen_member;
  let retry_count = -1;

  // await pr.reply(`roulette_${ts}`, `:thinking-face-fast:`);

  do {
    if (retry_count++ >= 20 || member_set.size === 0) {
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
      member_set.delete(chosen_member.id);
      chosen_member = null;
    }
  } while (!chosen_member);

  await pr.reply(`roulette_${ts}`, `:kuchiyose_smoke:`);
  await wait(250);

  const text = chosen_member
    ? `:${get_random_item(possible_emojis)}: ${Message.get_user_mention(
        chosen_member.id,
      )}`
    : `For some reason I couldn't choose a random channel member... :sob:`;

  await pr.reply(`roulette_${ts}`, text, chosen_member);
  channel.save_pr(pr);
};
