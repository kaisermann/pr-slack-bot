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

  const channel_message_path = (channel, type) =>
    ['channels', channel, 'messages', type].filter(Boolean);

  const DB_PR_PATH = ['channels', channel_id, 'prs'];

  function get_messages(type) {
    return DB.get_channel_messages(channel_id, type);
  }

  async function on_prs_resolved(resolved_prs) {
    const forgotten_list_messages = get_messages('forgotten_prs').filter(
      ({ payload }) => resolved_prs.some(pr => payload.indexOf(pr.slug) >= 0),
    );

    for await (const message of forgotten_list_messages) {
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
        payload: message.payload.filter(slug => slug !== pr.slug),
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
    // { slug: [pr, update_result] }
    const results = await Promise.all(
      prs.map(pr => pr.update().then(result => [pr, result])),
    ).then(updates =>
      updates.reduce((acc, [pr, result]) => {
        acc[pr.slug] = [pr, result];
        return acc;
      }, {}),
    );
    // { slug: [pr, update_result] }
    const updated_prs = filter_object(
      results,
      ([, result]) => result.has_changed,
    );
    // { slug: [pr, update_result] }
    const resolved_prs = filter_object(
      updated_prs,
      ([pr]) => pr.state.merged || pr.state.closed,
    );

    if (Object.keys(resolved_prs).length) {
      on_prs_resolved(Object.values(resolved_prs).map(([pr]) => pr));
    }

    DB.client
      .get(DB_PR_PATH)
      .each(pr => {
        if (pr.slug in updated_prs) {
          const updated_pr = updated_prs[pr.slug][0];
          Object.assign(pr, updated_pr.to_json());
        }
      })
      .remove(pr => pr.slug in resolved_prs)
      .write();
    return results;
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
