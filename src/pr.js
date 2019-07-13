const is_equal = require('fast-deep-equal');
const Github = require('./api/github.js');
const Slack = require('./api/slack.js');
const Logger = require('./api/logger.js');
const { EMOJIS, QUICK_ADDITION_LIMIT, NEEDED_REVIEWS } = require('./consts.js');
const DB = require('./api/db.js');
const Message = require('./message.js');

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
    // we use the last review of an user as the current review state
    const review_sets = Object.entries(
      review_data.reduce((acc, { user, state: review_state }) => {
        if (!acc[user.login]) acc[user.login] = [];
        acc[user.login].push(review_state);
        return acc;
      }, {}),
    );

    const changes_requested = review_sets.some(
      ([, set]) => set.indexOf('CHANGES_REQUESTED') > set.indexOf('APPROVED'),
    );

    const approved =
      !changes_requested &&
      review_sets.filter(([, set]) => set.includes('APPROVED')).length >=
        NEEDED_REVIEWS;

    const requested_reviewers = pr_data.requested_reviewers.map(({ login }) => {
      const user = DB.get_user_by_github_username(login);
      return user || { github_username: login };
    });

    state = Object.freeze({
      requested_reviewers,
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

  async function update_status() {
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
        requested_reviewers,
      } = state;

      const changes = {};

      changes.changes_requested = changes_requested
        ? add_reaction(EMOJIS.changes)
        : remove_reaction(EMOJIS.changes);

      if (quick) {
        changes.quick = add_reaction(EMOJIS.quick_read);
      }

      if (reviewed) {
        changes.reviewed = add_reaction(EMOJIS.commented);
      }

      if (unstable) {
        changes.unstable = add_reaction(EMOJIS.unstable);
      } else {
        changes.unstable = remove_reaction(EMOJIS.unstable);
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

      if (merged || closed) {
        if (merged) {
          changes.merged = add_reaction(EMOJIS.merged);
        } else {
          changes.closed = add_reaction(EMOJIS.closed);
        }
      }

      if (requested_reviewers.length > 0) {
        const slack_user_ids = requested_reviewers
          .map(u => u && u.id)
          .filter(Boolean);

        if (slack_user_ids.length > 0) {
          changes.reviewers = reply(
            'reviewers',
            () =>
              `Assigned reviewers: ${slack_user_ids
                .map(id => `<@${id}>`)
                .join(', ')}`,
            slack_user_ids,
          );
        }
      } else if ('reviewers' in replies) {
        delete_reply('reviewers');
        changes.reviewers = true;
      }

      return Promise.all(Object.values(changes)).then(changed_results => {
        return {
          has_changed: changed_results.some(changed => changed !== false),
          changes,
        };
      });
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
    update_status,
    get_message_url,
    time_since_post,
    reply,
    needs_attention,
  });
};
