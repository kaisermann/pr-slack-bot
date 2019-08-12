const R = require('ramda');
const DB = require('./api/db.js');
const Logger = require('./api/logger.js');
const { EMOJIS, FORGOTTEN_PR_HOUR_THRESHOLD } = require('./consts.js');
const Message = require('./message.js');
const PR = require('./pr.js');

const get_resolved_prs = R.pickBy(pr => pr.state.merged || pr.state.closed);
const get_to_update_prs = R.pickBy(
  pr =>
    pr.last_update &&
    pr.last_update.has_changed &&
    !pr.state.merged &&
    !pr.state.closed,
);

exports.create = ({ channel_id, name: channel_name, prs, messages }) => {
  prs = prs.map(PR.create);

  const DB_PR_PATH = ['channels', channel_id, 'prs'];

  function get_messages(type) {
    return DB.get_channel_messages(channel_id, type);
  }

  function get_active_prs() {
    return prs.filter(pr => pr.is_active());
  }

  // TODO
  // async function send_message(type, message) {}

  async function update_pr(slug) {
    const pr = prs.find(pr => pr.slug === slug);

    await pr.update();

    if (!pr.is_active()) return;

    const has_changed = pr.last_update.has_changed;
    const is_resolved = pr.state.merged || pr.state.closed;

    if (is_resolved) {
      on_prs_resolved({ [pr.slug]: pr });
    }

    let db_transaction = DB.client.get(DB_PR_PATH);
    if (is_resolved) {
      remove_pr(pr);
    } else if (has_changed) {
      save_pr(pr);
    }
    db_transaction.write();
  }

  async function update_prs() {
    const active_prs = get_active_prs();
    console.log(
      `# ${channel_name} ${channel_id} - Updating PRs (${active_prs.length} prs)`,
    );

    // await prs.reduce(async (acc, pr) => acc.then(pr.update), Promise.resolve());
    try {
      const result_prs = await Promise.all(active_prs.map(pr => pr.update()));
      const { updated_prs, errored_prs } = R.groupBy(
        pr => (pr.last_update == null ? 'errored_prs' : 'updated_prs'),
        result_prs,
      );

      if (errored_prs) {
        errored_prs.forEach(pr =>
          Logger.log_error(`Error with PR: ${pr.slug}`),
        );
      }

      if (updated_prs == null) {
        return;
      }

      const prs_map = R.fromPairs(updated_prs.map(pr => [pr.slug, pr]));
      const resolved_prs_map = get_resolved_prs(prs_map);
      const to_update_prs_map = get_to_update_prs(prs_map);

      const resolved_prs = Object.values(resolved_prs_map);
      if (resolved_prs.length) {
        await on_prs_resolved(resolved_prs_map);
        prs = prs.filter(({ slug }) => !(slug in resolved_prs_map));
      }

      DB.client
        .get(DB_PR_PATH)
        // update prs
        .each(pr => {
          if (pr.slug in to_update_prs_map) {
            const updated_pr = to_update_prs_map[pr.slug];
            Object.assign(pr, updated_pr.to_json());
          }
        })
        .remove(pr => pr.slug in resolved_prs_map)
        .write();

      console.log('');
    } catch (e) {
      Logger.log_error('Something wrong happened', e);
    }
  }

  function has_pr(slug) {
    return prs.find(pr => pr.slug === slug);
  }

  function add_pr(pr_data) {
    const pr = PR.create(pr_data);

    prs.push(pr);
    DB.client
      .get(DB_PR_PATH, [])
      .push(pr.to_json())
      .write();

    return pr;
  }

  function replace_pr(slug, pr_data) {
    const saved_pr_index = prs.findIndex(pr => pr.slug === slug);

    if (saved_pr_index < 0) return null;

    prs[saved_pr_index] = PR.create(
      Object.assign(prs[saved_pr_index].to_json(), pr_data, {
        reactions: {},
        replies: {},
        pr_actions: [],
      }),
    );

    save_pr(prs[saved_pr_index]);

    return prs[saved_pr_index];
  }

  function save_pr(pr) {
    const index = prs.findIndex(({ slug }) => slug === pr.slug);
    if (index < 0) return;

    DB.client
      .get(DB_PR_PATH, [])
      .find({ slug: pr.slug })
      .assign(pr.to_json())
      .write();
  }

  async function remove_pr_by_timestamp(deleted_ts) {
    const index = prs.findIndex(({ ts }) => ts === deleted_ts);
    if (index < 0) return;

    const pr = prs[index];

    pr.invalidate_etag_signature();

    await pr.delete_replies();

    prs.splice(index, 1);

    return DB.client
      .get(DB_PR_PATH)
      .remove({ ts: deleted_ts })
      .write();
  }

  function remove_pr({ slug }) {
    const index = prs.findIndex(pr => pr.slug === slug);
    if (index < 0) return;

    prs[index].invalidate_etag_signature();
    prs.splice(index, 1);

    DB.client
      .get(DB_PR_PATH)
      .remove({ slug: slug })
      .write();
  }

  async function on_prs_resolved(resolved_prs_map) {
    const resolved_prs = Object.values(resolved_prs_map);
    const forgotten_messages = get_messages('forgotten_prs').filter(
      ({ payload }) => payload.some(slug => slug in resolved_prs_map),
    );

    for await (const message of forgotten_messages) {
      const { text } = message;
      const new_text = resolved_prs.reduce((acc, pr) => {
        const state_emoji = pr.state.merged
          ? EMOJIS.merged
          : pr.state.closed
          ? EMOJIS.closed
          : EMOJIS.unknown;

        return acc.replace(
          new RegExp(`^(<.*${pr.repo}/${pr.pr_id}>.*$)`, 'm'),
          `:${state_emoji}: ~$1~`,
        );
      }, text);

      if (text === new_text) return;

      Logger.log_pr_action(
        `Updating forgotten PR message: ${resolved_prs.map(pr => pr.slug)}`,
      );
      const updated_message = await Message.update(message, {
        text: new_text,
        payload: message.payload.filter(slug => !(slug in resolved_prs_map)),
      });

      if (updated_message.payload.length === 0) {
        DB.remove_channel_message(updated_message);
      } else {
        DB.update_channel_message(updated_message);
      }
    }
  }

  async function check_forgotten_prs() {
    const forgotten_prs = prs.filter(pr =>
      pr.needs_attention(FORGOTTEN_PR_HOUR_THRESHOLD),
    );

    if (forgotten_prs.length === 0) return;

    const link_map = R.fromPairs(
      await Promise.all(
        forgotten_prs.map(async pr => [pr.slug, await pr.get_message_url()]),
      ),
    );

    const get_pr_link = pr => `<${[link_map[pr.slug]]}|${pr.repo}/${pr.pr_id}>`;

    const sections = forgotten_prs.reduce(
      (acc, pr) => {
        let section;
        if (pr.state.ready_to_merge) section = acc.ready_to_merge;
        else if (pr.state.dirty || pr.state.unstable)
          section = acc.unstable_or_dirty;
        else if (pr.state.changes_requested) section = acc.changes_requested;
        else section = acc.waiting_review;

        section.list.push(pr);

        return acc;
      },
      {
        ready_to_merge: {
          title: `:${EMOJIS.ready_to_merge}: Ready to be merged`,
          list: [],
        },
        changes_requested: {
          title: `:${EMOJIS.changes_requested}: Changes requested`,
          list: [],
        },
        unstable_or_dirty: {
          title: `:${EMOJIS.unstable}: Unstable or needs rebase`,
          list: [],
        },
        waiting_review: {
          title: `:${EMOJIS.waiting}: Waiting review`,
          list: [],
        },
      },
    );

    const sections_text = R.pipe(
      R.values,
      R.filter(({ list }) => list.length),
      R.map(
        ({ title, list }) =>
          `*${title}*:\n` +
          `${list
            .map(
              pr =>
                `${get_pr_link(pr)} ` + `_(${pr.hours_since_post} hours ago)_`,
            )
            .join('\n')}`,
      ),
      R.join('\n\n'),
    )(sections);

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
          `${list.map(pr => get_pr_link(pr)).join(', ')}`,
      ),
      R.join('\n\n'),
    )(forgotten_prs)}`;

    message.replies.mentions = await Message.send({
      channel: channel_id,
      thread_ts: message.ts,
      text: owners_text,
    });

    DB.save_channel_message(message, 2);
  }

  return Object.freeze({
    // props
    channel_id,
    get messages() {
      return messages;
    },
    get prs() {
      return prs;
    },
    // methods
    update_pr,
    update_prs,
    has_pr,
    add_pr,
    remove_pr,
    remove_pr_by_timestamp,
    replace_pr,
    check_forgotten_prs,
  });
};
