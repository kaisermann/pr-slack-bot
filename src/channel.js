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

  async function on_prs_resolved(resolved_prs) {
    const prs = Object.values(resolved_prs);
    const forgotten_messages = get_messages('forgotten_prs').filter(
      ({ payload }) => payload.some(slug => slug in resolved_prs),
    );

    for await (const message of forgotten_messages) {
      const { text } = message;
      const new_text = prs.reduce((acc, pr) => {
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
        `Updating forgotten PR message: ${prs.map(pr => pr.slug)}`,
      );
      const updated_message = await Message.update(message, {
        text: new_text,
        payload: message.payload.filter(slug => !(slug in resolved_prs)),
      });

      if (updated_message.payload.length === 0) {
        DB.remove_channel_message(updated_message);
      } else {
        DB.update_channel_message(updated_message);
      }
    }
  }

  async function update_prs() {
    console.log(`# ${channel_id} - Updating PRs`);

    const updates_result = await Promise.all(prs.map(pr => pr.update()));

    const prs_map = updates_result.reduce((acc, pr) => {
      acc[pr.slug] = pr;
      return acc;
    }, {});
    const updated_prs_map = filter_object(
      prs_map,
      pr => pr.last_update.has_changed,
    );
    const resolved_prs_map = filter_object(
      updated_prs_map,
      pr => pr.state.merged || pr.state.closed,
    );

    if (Object.keys(resolved_prs_map).length) {
      on_prs_resolved(resolved_prs_map);
    }

    DB.client
      .get(DB_PR_PATH)
      // update prs
      .each(pr => {
        if (pr.slug in updated_prs_map) {
          const updated_pr = updated_prs_map[pr.slug];
          Object.assign(pr, updated_pr.to_json());
        }
      })
      // remove resolved prs
      .remove(pr => pr.slug in resolved_prs_map)
      .write();
    return updates_result;
  }

  return Object.freeze({
    // props
    channel_id,
    messages,
    prs,
    // methods
    update_prs,
  });
};
