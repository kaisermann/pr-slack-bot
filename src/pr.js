const is_equal = require('fast-deep-equal');

const Github = require('./api/github.js');
const Slack = require('./api/slack.js');
const Logger = require('./api/logger.js');
const DB = require('./api/db.js');
const Message = require('./message.js');

const { EMOJIS, QUICK_ADDITION_LIMIT, NEEDED_REVIEWS } = require('./consts.js');

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

// todo: prevent always creating new PR obj on memory for every db.get
exports.create = ({
  slug,
  owner,
  repo,
  pr_id,
  channel,
  ts,
  replies = {},
  reactions = [],
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

  async function reply(id, text, payload) {
    if (id in replies) {
      const saved_reply = replies[id];

      if (is_equal(saved_reply.payload, payload)) return false;

      if (typeof text === 'function') {
        text = text().trim();
      }

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

    if (typeof text === 'function') {
      text = text().trim();
    }

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

  async function add_reaction(name) {
    if (reactions.includes(name)) {
      return false;
    }

    Logger.log_pr_action(`Adding reaction: ${name}`);
    Logger.add_call('slack.reactions.add');

    return Slack.web_client.reactions
      .add({ name, timestamp: ts, channel })
      .then(() => {
        reactions.push(name);
        return true;
      })
      .catch(e => {
        if (e.data.error === 'already_reacted') {
          reactions.push(name);
        }

        if (process.env.NODE_ENV !== 'production') {
          Logger.log_error(e);
        }
        return false;
      });
  }

  async function remove_reaction(name) {
    if (!reactions.includes(name)) {
      return false;
    }

    Logger.log_pr_action(`Removing reaction: ${name}`);
    Logger.add_call('slack.reactions.remove');

    return Slack.web_client.reactions
      .remove({ name, timestamp: ts, channel })
      .then(() => {
        reactions = reactions.filter(r => r !== name);
        return true;
      })
      .catch(e => {
        if (e.data.error === 'no_reaction') {
          reactions = reactions.filter(r => r !== name);
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

    const on_hold = pr_data.labels.some(({ name }) =>
      name.match(/(on )?hold/),
    );

    state = Object.freeze({
      pr_actions,
      changes_requested,
      approved,
      quick: pr_data.additions <= QUICK_ADDITION_LIMIT,
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
    const { pr_actions } = state;

    const text =
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
          };

    return reply('header_message', text, pr_actions);
  }

  async function update_reactions() {
    const {
      changes_requested,
      quick,
      reviewed,
      unstable,
      merged,
      closed,
    } = state;

    const changes = {};

    if (quick) {
      changes.quick = await add_reaction(EMOJIS.quick_read);
    }

    changes.changes_requested = changes_requested
      ? await add_reaction(EMOJIS.changes_requested)
      : await remove_reaction(EMOJIS.changes_requested);

    changes.unstable = unstable
      ? await add_reaction(EMOJIS.unstable)
      : await remove_reaction(EMOJIS.unstable);

    if (reviewed) {
      changes.reviewed = await add_reaction(EMOJIS.commented);
    }

    if (merged) {
      changes.merged = await add_reaction(EMOJIS.merged);
    } else if (closed) {
      changes.closed = await add_reaction(EMOJIS.closed);
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
