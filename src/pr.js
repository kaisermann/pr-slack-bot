const is_equal = require('fast-deep-equal');

const Github = require('./api/github.js');
const Slack = require('./api/slack.js');
const Logger = require('./api/logger.js');
const DB = require('./api/db.js');
const Message = require('./message.js');

const { EMOJIS, PR_SIZES, NEEDED_REVIEWS } = require('./consts.js');

const ACTIONS = Object.freeze({
  changes_requested: 'CHANGES_REQUESTED',
  approved: 'APPROVED',
  review_requested: 'REVIEW_REQUESTED',
  commented: 'COMMENTED',
  merged: 'MERGED',
  unknown: 'UNKNOWN',
});

function has_changes_requested(action_list) {
  return (
    action_list.indexOf(ACTIONS.changes_requested) >
    action_list.indexOf(ACTIONS.approved)
  );
}

function get_pr_action(action_list) {
  if (has_changes_requested(action_list)) return ACTIONS.changes_requested;
  if (action_list.includes(ACTIONS.approved)) return ACTIONS.approved;
  if (action_list.includes(ACTIONS.commented)) return ACTIONS.commented;
  return ACTIONS.unknown;
}

function get_action_label(pr_action) {
  if (pr_action === ACTIONS.approved)
    return { label: 'Approved', emoji: EMOJIS.approved };
  if (pr_action === ACTIONS.changes_requested)
    return { label: 'Changes requested', emoji: EMOJIS.changes_requested };
  if (pr_action === ACTIONS.review_requested)
    return { label: 'Waiting review', emoji: EMOJIS.review_requested };
  if (pr_action === ACTIONS.commented)
    return { label: 'Commented', emoji: EMOJIS.commented };
  if (pr_action === ACTIONS.merged)
    return { label: 'Merged by', emoji: EMOJIS.merged };
  return { label: 'Unknown action', emoji: EMOJIS.unknown };
}

function get_pr_size(additions, deletions) {
  const n_changes = additions + deletions;
  let i;
  for (i = 0; i < PR_SIZES.length && n_changes > PR_SIZES[i][1]; i++);
  return {
    label: PR_SIZES[i][0],
    limit: PR_SIZES[i][1],
    n_changes,
    additions,
    deletions,
  };
}

// todo: prevent always creating new PR obj on memory for every db.get
exports.create = ({
  slug,
  owner,
  repo,
  pr_id,
  channel,
  ts,
  replies = {},
  reactions = {},
  state = {},
}) => {
  let _cached_url;

  async function get_message_url() {
    if (_cached_url == null) {
      _cached_url = await Slack.get_message_url(channel, ts);
    }
    return _cached_url;
  }

  async function delete_reply(id) {
    await Message.delete(replies[id]);
    delete replies[id];
  }

  function build_message_text(parts) {
    parts = Array.isArray(parts) ? parts : [parts];
    return parts
      .map(part => (typeof part === 'function' ? part() : part))
      .join('');
  }

  async function reply(id, text_parts, payload) {
    if (id in replies) {
      const saved_reply = replies[id];

      if (is_equal(saved_reply.payload, payload)) return false;

      const text = build_message_text(text_parts);

      if (saved_reply.text === text) return false;

      if (text === '') {
        await delete_reply(id);
        return true;
      }

      try {
        replies[id] = await Message.update(saved_reply, { text, payload });
      } catch (e) {
        Logger.log_error(
          saved_reply.channel,
          saved_reply.ts,
          saved_reply.text,
          e,
        );
      }
      return true;
    }

    const text = build_message_text(text_parts);

    if (text === '') return false;

    Logger.log_pr_action(`Sending reply: ${text}`);
    return Message.send({
      text,
      channel,
      thread_ts: ts,
      payload,
    })
      .then(message => {
        replies[id] = message;
        return true;
      })
      .catch(e => {
        Logger.log_error(text, channel, ts, e);
        return false;
      });
  }

  async function remove_reaction(type) {
    if (!(type in reactions)) {
      return false;
    }

    const name = reactions[type];

    Logger.log_pr_action(
      `Removing reaction of type: ${type} (${reactions[type]})`,
    );
    Logger.add_call('slack.reactions.remove');

    return Slack.web_client.reactions
      .remove({ name, timestamp: ts, channel })
      .then(() => {
        delete reactions[type];
        return true;
      })
      .catch(e => {
        if (e.data.error === 'no_reaction') {
          delete reactions[type];
        }

        if (process.env.NODE_ENV !== 'production') {
          Logger.log_error(e);
        }
        return false;
      });
  }

  async function add_reaction(type, name) {
    if (type in reactions) {
      if (reactions[type] === name) return false;
      await remove_reaction(type);
    }

    Logger.log_pr_action(`Adding reaction of type: ${type} (${name})`);
    Logger.add_call('slack.reactions.add');

    return Slack.web_client.reactions
      .add({ name, timestamp: ts, channel })
      .then(() => {
        reactions[type] = name;
        return true;
      })
      .catch(e => {
        if (e.data.error === 'already_reacted') {
          reactions[type] = name;
        }

        if (process.env.NODE_ENV !== 'production') {
          Logger.log_error(e);
        }
        return false;
      });
  }

  async function update_state() {
    const pr_data = await Github.get_pr_data(owner, repo, pr_id);
    const review_data = await Github.get_review_data(owner, repo, pr_id);

    // review data mantains a list of reviews
    const action_lists = Object.entries(
      review_data.reduce((acc, { user, state: pr_action }) => {
        if (!acc[user.login]) acc[user.login] = [];
        acc[user.login].push(pr_action);
        return acc;
      }, {}),
    )
      // don't want status update by the assignee of the pr
      .filter(
        ([login]) =>
          pr_data.assignee == null || login !== pr_data.assignee.login,
      );

    const changes_requested = action_lists.some(([, list]) =>
      has_changes_requested(list),
    );
    const approvals = action_lists.filter(([, list]) =>
      list.includes(ACTIONS.approved),
    );
    const approved = !changes_requested && approvals.length >= NEEDED_REVIEWS;

    const requested_reviewers = pr_data.requested_reviewers.map(({ login }) => {
      return {
        github_user: login,
        pr_action: ACTIONS.review_requested,
      };
    });
    const merged_by =
      pr_data.merged_by != null
        ? [{ github_user: pr_data.merged_by.login, pr_action: ACTIONS.merged }]
        : [];
    const actual_reviewers = action_lists.map(([github_user, action_list]) => {
      return {
        github_user,
        pr_action: get_pr_action(action_list),
      };
    });
    const pr_actions = requested_reviewers
      .concat(actual_reviewers)
      .concat(merged_by)
      .map(({ github_user, pr_action }) => {
        const user = DB.get_user_by_github_user(github_user);
        if (user) {
          return { ...user, pr_action };
        }
        return { github_user, pr_action };
      });

    const on_hold = pr_data.labels.some(({ name }) => name.match(/(on )?hold/));

    const pr_size = get_pr_size(pr_data.additions, pr_data.deletions);

    state = Object.freeze({
      pr_actions,
      changes_requested,
      approved,
      size: pr_size,
      reviewed: pr_data.review_comments > 0,
      merged: pr_data.merged,
      mergeable: pr_data.mergeable,
      dirty: pr_data.mergeable_state === 'dirty',
      unstable: pr_data.mergeable_state === 'unstable',
      closed: pr_data.state === 'closed',
      pr_branch: pr_data.head.ref,
      base_branch: pr_data.base.ref,
      on_hold,
    });

    return state;
  }

  async function update_header_message() {
    const { pr_actions, size } = state;

    const text_parts = [
      () => {
        return `:${EMOJIS[`size_${size.label}`]}: *PR size*: ${size.label} (_${
          size.n_changes
        } changes_)\n\n`;
      },
      pr_actions.length === 0
        ? `Waiting for reviewers :${EMOJIS.waiting}:`
        : () => {
            const header_text = Object.entries(
              pr_actions.reduce((acc, { id, github_user, pr_action }) => {
                if (!(pr_action in acc)) acc[pr_action] = [];

                const mention = id ? `<@${id}>` : github_user;
                acc[pr_action].push(mention);
                return acc;
              }, {}),
            )
              .map(([pr_action, mentions]) => {
                const { label, emoji } = get_action_label(pr_action);
                return `:${emoji}: *${label}*: ${mentions.join(', ')}`;
              })
              .join('\n\n');

            return header_text;
          },
    ];

    return reply('header_message', text_parts, { size, pr_actions });
  }

  async function update_reactions() {
    const {
      changes_requested,
      size,
      reviewed,
      unstable,
      merged,
      closed,
    } = state;

    const changes = {};

    if (size.label !== 'small') {
      changes.size = await add_reaction('size', EMOJIS[`size_${size.label}`]);
    }

    changes.changes_requested = changes_requested
      ? await add_reaction('changes_requested', EMOJIS.changes_requested)
      : await remove_reaction('changes_requested');

    changes.unstable = unstable
      ? await add_reaction('unstable', EMOJIS.unstable)
      : await remove_reaction('unstable');

    if (reviewed) {
      changes.reviewed = await add_reaction('reviewed', EMOJIS.commented);
    }

    if (merged) {
      changes.merged = await add_reaction('merged', EMOJIS.merged);
    } else if (closed) {
      changes.closed = await add_reaction('closed', EMOJIS.closed);
    }

    return changes;
  }

  async function update_replies() {
    const {
      unstable,
      dirty,
      pr_branch,
      base_branch,
      approved,
      merged,
      closed,
    } = state;

    const changes = {
      header_message: await update_header_message(),
    };

    // no need to await those replies
    if (dirty) {
      changes.dirty = reply(
        'is_dirty',
        `The branch \`${pr_branch}\` is dirty. It may need a rebase with \`${base_branch}\`.`,
      );
    }

    if (approved && !unstable && !merged && !closed) {
      changes.ready_to_merge = reply(
        'ready_to_merge',
        'PR is ready to be merged :doit:!',
      );
    }

    return changes;
  }

  async function update() {
    try {
      await update_state();
      Logger.log(`PR: ${slug}`);
      const reaction_changes = await update_reactions();
      const message_changes = await update_replies();

      const changed_results = await Promise.all(
        Object.values(message_changes).concat(Object.values(reaction_changes)),
      );
      return {
        has_changed: changed_results.some(changed => changed !== false),
        changes: {
          replies: message_changes,
          reactions: reaction_changes,
        },
      };
    } catch (error) {
      Logger.log_error(error);
    }

    state = Object.freeze({});
    return {};
  }

  function to_json() {
    return {
      slug,
      owner,
      repo,
      pr_id,
      channel,
      ts,
      reactions,
      replies,
    };
  }

  return Object.freeze({
    // props
    slug,
    owner,
    repo,
    pr_id,
    channel,
    ts,
    get state() {
      return state;
    },
    get minutes_since_post() {
      return Math.abs(new Date(ts * 1000) - new Date()) / (1000 * 60);
    },
    get hours_since_post() {
      return ~~(this.minutes_since_post / 60);
    },
    // methods
    to_json,
    update,
    get_message_url,
    reply,
    needs_attention(hours) {
      return this.minutes_since_post >= 60 * hours;
    },
  });
};
