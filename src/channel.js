const DB = require('./api/db.js');

const Logger = require('./api/logger.js');
const { EMOJIS } = require('./consts.js');
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

exports.create = ({ channel_id, prs, messages }) => {
  prs = prs.map(PR.create);

  const DB_PR_PATH = ['channels', channel_id, 'prs'];

  function get_messages(type) {
    return DB.get_channel_messages(channel_id, type);
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

  async function update_pr(pr_data) {
    const pr = prs.find(pr => pr.slug === pr_data.slug);
    const update_result = await pr.update();

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

    return update_result;
  }

  async function update_prs() {
    console.log(`# ${channel_id} - Updating PRs`);

    const updates_result = await Promise.all(prs.map(pr => pr.update()));

    const prs_map = updates_result.reduce((acc, pr) => {
      acc[pr.slug] = pr;
      return acc;
    }, {});
    const changed_prs_map = filter_object(
      prs_map,
      pr => pr.last_update.has_changed,
    );
    const resolved_prs_map = filter_object(
      changed_prs_map,
      pr => pr.state.merged || pr.state.closed,
    );
    const to_update_prs_map = filter_object(
      resolved_prs_map,
      pr => !pr.state.merged && !pr.state.closed,
    );

    const resolved_prs = Object.values(resolved_prs_map);

    if (resolved_prs.length) {
      await on_prs_resolved(resolved_prs_map);
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
    return updates_result;
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

  function set_pr(pr_data) {
    const saved_pr_index = prs.findIndex(({ slug }) => slug === pr_data.slug);

    if (saved_pr_index < 0) return null;
    prs[saved_pr_index] = PR.create(pr_data);

    save_pr(prs[saved_pr_index]);

    return prs[saved_pr_index];
  }

  function save_pr(pr) {
    const index = prs.findIndex(({ slug }) => slug === pr.slug);
    if (index < 0) return null;
    DB.client.find({ slug: pr.slug }).assign(pr.to_json());
  }

  function remove_pr_by_timestamp(deleted_ts) {
    const index = prs.findIndex(({ ts }) => ts === deleted_ts);
    if (index < 0) return null;

    prs.splice(index, 1);

    return DB.client
      .get(DB_PR_PATH)
      .remove({ ts: deleted_ts })
      .write();
  }
  function remove_pr({ slug }) {
    const index = prs.findIndex(({ slug }) => slug === slug);
    if (index < 0) return null;

    prs.splice(index, 1);

    DB.client
      .get(DB_PR_PATH)
      .remove({ slug: slug })
      .write();
  }

  return Object.freeze({
    // props
    channel_id,
    messages,
    prs,
    // methods
    update_pr,
    update_prs,
    has_pr,
    add_pr,
    remove_pr,
    remove_pr_by_timestamp,
    set_pr,
  });
};
