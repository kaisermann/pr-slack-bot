const R = require('ramda');

const Slack = require('./api/slack.js');
const DB = require('./api/db.js');

const { EMOJIS, FORGOTTEN_PR_HOUR_THRESHOLD } = require('./consts.js');
const Message = require('./message.js');
const runtime = require('./runtime.js');

const format_section_list = require('./messages/section_pr_list.js');

const Lock = require('./includes/lock.js');
const Logger = require('./includes/logger.js');

exports.factory = ({
  channel_id,
  name: channel_name,
  prs: prs_slug = [],
  messages,
}) => {
  const forgotten_message_lock = new Lock();
  const DB_PR_PATH = [channel_id, 'prs'];
  const DB_MSG_PATH = [channel_id, 'messages'];
  const get_db_message_path = type => [...DB_MSG_PATH, type].filter(Boolean);

  prs_slug = new Set(prs_slug);

  function remove_message(message) {
    const { ts, type } = message;
    DB.channels
      .get(get_db_message_path(type), [])
      .remove({ ts })
      .write();
  }

  function update_message(message) {
    const { type, ts } = message;
    DB.channels
      .get(get_db_message_path(type), [])
      .find({ ts })
      .assign(message)
      .write();
  }

  function save_message(message, limit) {
    const { type } = message;
    let messages_of_type = DB.channels
      .get(get_db_message_path(type), [])
      .push(message);

    if (typeof limit === 'number') {
      messages_of_type = messages_of_type.takeRight(limit);
    }

    return DB.channels
      .get(get_db_message_path(), [])
      .set(type, messages_of_type.value())
      .write();
  }

  function get_messages(type) {
    return DB.channels.get(get_db_message_path(type), []).value();
  }

  function add_pr(pr) {
    prs_slug.add(pr.slug);
    DB.channels.set(DB_PR_PATH, [...prs_slug]).write();
  }

  function remove_pr(pr) {
    prs_slug.delete(pr.slug);
    DB.channels.set(DB_PR_PATH, [...prs_slug]).write();
  }

  async function after_pr_update(pr) {
    if (!pr.is_resolved()) {
      return;
    }

    await forgotten_message_lock.acquire();

    const forgotten_messages = get_messages('forgotten_prs').filter(
      ({ payload }) => payload.some(slug => pr.slug === slug),
    );

    if (forgotten_messages.length) {
      Logger.info(`- Updating forgotten PR message: ${pr.slug}`);
    }

    for await (const message of forgotten_messages) {
      const { text } = message;
      const state_emoji = pr.state.merged
        ? EMOJIS.merged
        : pr.state.closed
        ? EMOJIS.closed
        : EMOJIS.unknown;

      const new_text = text.replace(
        new RegExp(`^(<.*${pr.repo}/${pr.number}>.*$)`, 'm'),
        `:${state_emoji}: ~$1~`,
      );

      if (text === new_text) return;

      const updated_message = await Message.update(message, {
        text: new_text,
        payload: message.payload.filter(slug => pr.slug !== slug),
      });

      if (updated_message.payload.length === 0) {
        remove_message(updated_message);
      } else {
        update_message(updated_message);
      }
    }
    await forgotten_message_lock.release();

    remove_pr(pr);
  }

  function get_prs() {
    return [...prs_slug].map(slug => runtime.get_pr(slug));
  }

  async function check_forgotten_prs() {
    const forgotten_prs = get_prs().filter(pr =>
      pr.needs_attention(FORGOTTEN_PR_HOUR_THRESHOLD),
    );

    if (forgotten_prs.length === 0) return;

    const link_map = R.fromPairs(
      await Promise.all(
        forgotten_prs.map(async pr => [
          pr.slug,
          await pr.get_message_link(pr => `${pr.repo}/${pr.number}`),
        ]),
      ),
    );

    const sections_text = await format_section_list(forgotten_prs);

    const now_date = new Date(Date.now());
    const time_of_day = now_date.getHours() < 12 ? 'morning' : 'afternoon';

    const forgotten_text = `Good ${time_of_day}! :wave: Paul Robertson here!\nThere are some PRs posted more than 24 hours ago in need of some love and attention:\n\n${sections_text}`;

    const message = await Message.send({
      type: 'forgotten_prs',
      channel: channel_id,
      text: forgotten_text,
      payload: forgotten_prs.map(pr => pr.slug),
      replies: {},
    });

    const owners_text = `Can you help :awthanks:?\n\n${R.pipe(
      R.groupBy(pr => pr.poster_id),
      R.toPairs,
      R.filter(([, list]) => list.length),
      R.map(
        ([user_id, list]) =>
          `*<@${user_id}>*:\n` +
          `${list.map(pr => link_map[pr.slug]).join(', ')}`,
      ),
      R.join('\n\n'),
    )(forgotten_prs)}`;

    message.replies.mentions = await Message.send({
      channel: channel_id,
      thread_ts: message.ts,
      text: owners_text,
    });

    save_message(message, 2);
  }

  function to_json() {
    return {
      channel_id,
      name: channel_name,
      prs: [...prs_slug],
      messages,
    };
  }

  return Object.freeze({
    // props
    id: channel_id,
    name: channel_name,
    get messages() {
      return messages;
    },
    get prs() {
      return prs_slug;
    },
    // methods
    to_json,
    add_pr,
    remove_pr,
    get_prs,
    check_forgotten_prs,
    after_pr_update,
  });
};

exports.create_new = async channel_id => {
  const channel_info = await Slack.get_channel_info(channel_id);

  return exports.factory({
    channel_id,
    name: channel_info.name,
    prs: [],
    messages: {},
  });
};
