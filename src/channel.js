const R = require('ramda');

const DB = require('./api/db.js');
const { EMOJIS, FORGOTTEN_PR_HOUR_THRESHOLD } = require('./consts.js');
const Message = require('./message.js');
const PR = require('./pr.js');
const format_section_list = require('./messages/section_pr_list.js');
const Lock = require('./includes/lock.js');
const Logger = require('./includes/logger.js');

exports.create = ({ channel_id, name: channel_name, prs, messages }) => {
  const forgotten_message_lock = new Lock();
  const DB_PR_PATH = [channel_id, 'prs'];
  const DB_MSG_PATH = [channel_id, 'messages'];
  const get_db_message_path = type => [...DB_MSG_PATH, type].filter(Boolean);

  prs = prs.map(PR.create);

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

  function get_active_prs() {
    return prs.filter(pr => pr.is_active());
  }

  function update() {
    Logger.info(`# ${channel_name} ${channel_id} - Initializing PRs`);
    return Promise.all(
      get_active_prs().map(async pr => pr.update().then(on_pr_updated)),
    );
  }

  function has_pr(slug) {
    return prs.find(pr => pr.slug === slug);
  }

  function add_pr(pr_data) {
    const pr = PR.create(pr_data);

    prs.push(pr);
    DB.channels
      .get(DB_PR_PATH, [])
      .push(pr.to_json())
      .write();

    return pr;
  }

  function replace_pr(slug, pr_data) {
    const index = prs.findIndex(pr => pr.slug === slug);

    if (index < 0) return null;

    prs[index].invalidate_etag_signature();
    prs[index] = PR.create(
      Object.assign(prs[index].to_json(), pr_data, {
        reactions: {},
        replies: {},
      }),
    );

    return save_pr(prs[index]);
  }

  function save_pr(pr) {
    const index = prs.findIndex(({ slug }) => slug === pr.slug);
    if (index < 0) return;

    DB.channels
      .get(DB_PR_PATH, [])
      .find({ slug: pr.slug })
      .assign(pr.to_json())
      .write();

    return pr;
  }

  function remove_pr({ slug }) {
    const index = prs.findIndex(pr => pr.slug === slug);
    if (index < 0) return;

    prs[index].invalidate_etag_signature();
    prs.splice(index, 1);

    DB.channels
      .get(DB_PR_PATH)
      .remove({ slug: slug })
      .write();
  }

  async function remove_pr_by_timestamp(deleted_ts) {
    const index = prs.findIndex(({ ts }) => ts === deleted_ts);
    if (index < 0) return;

    prs[index].invalidate_etag_signature();
    await prs[index].delete_replies();

    prs.splice(index, 1);

    return DB.channels
      .get(DB_PR_PATH)
      .remove({ ts: deleted_ts })
      .write();
  }

  async function on_pr_updated(pr) {
    if (!pr.is_active()) return;

    const is_resolved = pr.state.merged || pr.state.closed;
    if (is_resolved) {
      await on_pr_resolved(pr);
      remove_pr(pr);
    } else {
      save_pr(pr);
    }
  }

  async function on_pr_resolved(pr) {
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
        new RegExp(`^(<.*${pr.repo}/${pr.pr_id}>.*$)`, 'm'),
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
  }

  async function check_forgotten_prs() {
    const forgotten_prs = prs.filter(pr =>
      pr.needs_attention(FORGOTTEN_PR_HOUR_THRESHOLD),
    );

    if (forgotten_prs.length === 0) return;

    const link_map = R.fromPairs(
      await Promise.all(
        forgotten_prs.map(async pr => [
          pr.slug,
          await pr.get_message_link(pr => `${pr.repo}/${pr.pr_id}`),
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

  return Object.freeze({
    // props
    id: channel_id,
    name: channel_name,
    get messages() {
      return messages;
    },
    get prs() {
      return prs;
    },
    // methods
    update,
    has_pr,
    add_pr,
    save_pr,
    remove_pr,
    remove_pr_by_timestamp,
    replace_pr,
    on_pr_updated,
    check_forgotten_prs,
  });
};
