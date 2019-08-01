const DB = require('./api/db.js');

const Logger = require('./api/logger.js');
const { EMOJIS, FORGOTTEN_PR_HOUR_THRESHOLD } = require('./consts.js');
const Message = require('./message.js');
const PR = require('./pr.js');

const filter_object = (o, fn) => {
  return Object.entries(o).reduce((acc, [key, value]) => {
    if (fn(value, key)) {
      acc[key] = value;
    }
    return acc;
  }, {});
};

exports.create = ({ channel_id, name: channel_name, prs, messages }) => {
  prs = prs.map(PR.create);

  const DB_PR_PATH = ['channels', channel_id, 'prs'];

  function get_messages(type) {
    return DB.get_channel_messages(channel_id, type);
  }

  function get_active_prs() {
    return prs.filter(pr => pr.is_active());
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
          new RegExp(`(<.*${pr.slug}>.*$)`, 'm'),
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
    const updated_prs = await Promise.all(active_prs.map(pr => pr.update()));

    const prs_map = updated_prs.reduce((acc, pr) => {
      acc[pr.slug] = pr;
      return acc;
    }, {});
    const changed_prs_map = filter_object(
      prs_map,
      pr => pr.last_update.has_changed,
    );
    const resolved_prs_map = filter_object(
      prs_map,
      pr => pr.state.merged || pr.state.closed,
    );
    const to_update_prs_map = filter_object(
      changed_prs_map,
      pr => !pr.state.merged && !pr.state.closed,
    );

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

  function remove_pr_by_timestamp(deleted_ts) {
    const index = prs.findIndex(({ ts }) => ts === deleted_ts);
    if (index < 0) return;

    prs.splice(index, 1);

    return DB.client
      .get(DB_PR_PATH)
      .remove({ ts: deleted_ts })
      .write();
  }

  function remove_pr({ slug }) {
    const index = prs.findIndex(pr => pr.slug === slug);
    if (index < 0) return;

    prs.splice(index, 1);

    DB.client
      .get(DB_PR_PATH)
      .remove({ slug: slug })
      .write();
  }

  async function check_forgotten_prs() {
    const forgotten_prs = prs.filter(pr =>
      pr.needs_attention(FORGOTTEN_PR_HOUR_THRESHOLD),
    );

    if (forgotten_prs.length === 0) return;

    const now_date = new Date(Date.now());
    const time_of_day = now_date.getHours() < 12 ? 'morning' : 'afternoon';

    let text = `Good ${time_of_day}! :wave: Paul Robertson here!\nThere are some PRs posted more than 24 hours ago in need of some love and attention:\n\n`;

    const sections = forgotten_prs.reduce(
      (acc, pr) => {
        if (pr.state.ready_to_merge) acc.ready_to_merge.list.push(pr);
        else if (pr.state.changes_requested)
          acc.changes_requested.list.push(pr);
        else acc.waiting_review.list.push(pr);
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
        waiting_review: {
          title: `:${EMOJIS.waiting}: Waiting review`,
          list: [],
        },
      },
    );

    for await (const { title, list } of Object.values(sections)) {
      if (list.length === 0) continue;

      text += `*${title}*:\n`;
      for await (const pr of list) {
        const message_url = await pr.get_message_url();
        text += `<${message_url}|${pr.slug}>`;
        text += ` _(${pr.hours_since_post} hours ago)_\n`;
      }
      text += '\n';
    }

    const message = await Message.send({
      type: 'forgotten_prs',
      channel: channel_id,
      text,
      payload: forgotten_prs.map(pr => pr.slug),
      replies: {},
    });

    const post_owners = [
      ...new Set(forgotten_prs.map(pr => pr.poster_id).filter(Boolean)),
    ];

    if (post_owners.length) {
      message.replies.mentions = await Message.send({
        channel: channel_id,
        thread_ts: message.ts,
        text: `Can you guys help :awthanks:? ${post_owners
          .map(id => `<@${id}>`)
          .join(', ')}`,
      });
    }

    DB.save_channel_message(message, 3);
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
