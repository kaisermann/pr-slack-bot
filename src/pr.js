const Github = require('./api/github.js');
const Slack = require('./api/slack.js');
const Logger = require('./api/logger.js');
const { EMOJIS, QUICK_ADDITION_LIMIT, NEEDED_REVIEWS } = require('./consts.js');
const DB = require('./api/db.js');

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

  async function reply(id, text, payload) {
    if (replies[id]) {
      return false;
    }

    Logger.log_pr_action(`Sending reply: ${text}`);
    const response = await Slack.send_message(text, channel, ts);
    if (response.ok) {
      replies[id] = { ts: response.ts, payload };
    }
    return replies[id];
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

  async function update_status() {
    try {
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

      const requested_reviewers = pr_data.requested_reviewers.map(
        ({ login }) => {
          const user = DB.get_user_by_github_username(login);
          return user || { github_username: login };
        },
      );

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
      });

      const changes = {};

      changes.changes_requested = state.changes_requested
        ? add_reaction(EMOJIS.changes)
        : remove_reaction(EMOJIS.changes);

      if (state.quick) {
        changes.quick = add_reaction(EMOJIS.quick_read);
      }

      if (state.reviewed) {
        changes.reviewed = add_reaction(EMOJIS.commented);
      }

      if (state.unstable) {
        changes.unstable = add_reaction(EMOJIS.unstable);
      } else {
        changes.unstable = remove_reaction(EMOJIS.unstable);
      }

      if (state.dirty) {
        changes.dirty = reply(
          'is_dirty',
          `The branch \`${pr_data.head.ref}\` is dirty. It may need a rebase with \`${pr_data.base.ref}\`.`,
        );
      }

      if (state.approved && !state.unstable && !state.merged && !state.closed) {
        changes.ready_to_merge = reply(
          'ready_to_merge',
          'PR is ready to be merged :doit:!',
        );
      }

      if (state.merged || state.closed) {
        if (state.merged) {
          changes.merged = add_reaction(EMOJIS.merged);
        } else {
          changes.closed = add_reaction(EMOJIS.closed);
        }
      }

      if (state.requested_reviewers.length > 0) {
        const slack_user_ids = state.requested_reviewers
          .map(u => u && u.id)
          .filter(Boolean);

        if (slack_user_ids.length > 0) {
          changes.reviewers = reply(
            'reviewers',
            `Assigned reviewers: ${slack_user_ids
              .map(id => `<@${id}>`)
              .join(', ')}`,
          );
        }
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
