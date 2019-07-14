const is_equal = require('fast-deep-equal');
const Github = require('./api/github.js');
const Slack = require('./api/slack.js');
const Logger = require('./api/logger.js');
const { EMOJIS, QUICK_ADDITION_LIMIT, NEEDED_REVIEWS } = require('./consts.js');
const DB = require('./api/db.js');
const Message = require('./message.js');

const ACTIONS = Object.freeze({
  changes_requested: 'CHANGES_REQUESTED',
  approved: 'APPROVED',
  review_requested: 'REVIEW_REQUESTED',
  commented: 'COMMENTED',
  merged: 'MERGED',
  unknown: 'UNKNOWN',
});

function get_action_label(pr_action) {
  if (pr_action === ACTIONS.approved) return 'Approved';
  if (pr_action === ACTIONS.changes_requested) return 'Changes Requested';
  if (pr_action === ACTIONS.review_requested) return 'Waiting Review';
  if (pr_action === ACTIONS.commented) return 'Commented';
  if (pr_action === ACTIONS.merged) return 'Merged';
  return 'Unknown action';
}

function has_changes_requested(review_set) {
  return (
    review_set.indexOf(ACTIONS.changes_requested) >
    review_set.indexOf(ACTIONS.approved)
  );
}

function get_pr_action(review_set) {
  if (has_changes_requested(review_set)) return ACTIONS.changes_requested;
  if (review_set.includes(ACTIONS.approved)) return ACTIONS.approved;
  if (review_set.includes(ACTIONS.commented)) return ACTIONS.commented;
  return ACTIONS.unknown;
}

function get_action_emoji(pr_action) {
  if (pr_action === ACTIONS.approved) return EMOJIS.approved;
  if (pr_action === ACTIONS.changes_requested) return EMOJIS.changes;
  if (pr_action === ACTIONS.review_requested) return EMOJIS.waiting_review;
  if (pr_action === ACTIONS.commented) return EMOJIS.commented;
  if (pr_action === ACTIONS.merged) return EMOJIS.merged;
  return EMOJIS.shrug;
}

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

  // return in minutes
  function time_since_post() {
    return Math.abs(new Date(ts * 1000) - new Date()) / (1000 * 60);
  }

  // consider in hours
  function needs_attention(hours) {
    return time_since_post() >= 60 * hours;
  }

  async function delete_reply(id) {
    await Message.delete(replies[id]);
    delete replies[id];
  }

  async function reply(id, text, payload) {
    if (id in replies) {
      const saved_reply = replies[id];

      if (is_equal(saved_reply.payload, payload)) {
        return false;
      }

      if (typeof text === 'function') {
        text = text().trim();
      }

      if (saved_reply.text === text) {
        return false;
      }

      if (text === '') {
        await delete_reply(id);
        return true;
      }

      replies[id] = await Message.update(saved_reply, { text, payload });
      return true;
    }

    if (typeof text === 'function') {
      text = text().trim();
    }

    if (text === '') {
      return false;
    }

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
        Logger.log_error(e);
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
    const action_sets = Object.entries(
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

    const changes_requested = action_sets.some(([, set]) =>
      has_changes_requested(set),
    );
    const approvals = action_sets.filter(([, set]) =>
      set.includes(ACTIONS.approved),
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
    const actual_reviewers = action_sets.map(([github_user, set]) => {
      return {
        github_user,
        pr_action: get_pr_action(set),
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
    });

    return state;
  }

  async function update_header_message() {
    const { pr_actions } = state;

    if (!pr_actions.length) return false;

    const text = () => {
      const header_text = Object.entries(
        pr_actions.reduce((acc, { id, github_user, pr_action }) => {
          if (!(pr_action in acc)) acc[pr_action] = [];

          const mention = id ? `<@${id}>` : github_user;
          acc[pr_action].push(mention);
          return acc;
        }, {}),
      )
        .map(([pr_action, mentions]) => {
          let group_text = `:${get_action_emoji(pr_action)}: - `;
          group_text += `*${get_action_label(pr_action)}*:\n`;
          group_text += mentions.join(', ');
          return group_text;
        })
        .join('\n\n');

      return header_text;
    };

    return reply('header_message', text, pr_actions);
  }

  async function update() {
    try {
      await update_state();

      const {
        changes_requested,
        quick,
        reviewed,
        unstable,
        dirty,
        pr_branch,
        base_branch,
        approved,
        merged,
        closed,
      } = state;

      const changes = {};

      changes.changes_requested = changes_requested
        ? add_reaction(EMOJIS.changes)
        : remove_reaction(EMOJIS.changes);

      changes.unstable = unstable
        ? add_reaction(EMOJIS.unstable)
        : remove_reaction(EMOJIS.unstable);

      if (quick) {
        changes.quick = add_reaction(EMOJIS.quick_read);
      }

      if (reviewed) {
        changes.reviewed = add_reaction(EMOJIS.commented);
      }

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

      changes.header_message = await update_header_message();

      if (merged) {
        changes.merged = add_reaction(EMOJIS.merged);
      } else if (closed) {
        changes.closed = add_reaction(EMOJIS.closed);
      }

      const changed_results = await Promise.all(Object.values(changes));
      return {
        has_changed: changed_results.some(changed => changed !== false),
        changes,
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
    get hours_since_post() {
      return ~~(time_since_post() / 60);
    },
    // methods
    to_json,
    add_reaction,
    remove_reaction,
    update,
    get_message_url,
    time_since_post,
    reply,
    needs_attention,
  });
};
