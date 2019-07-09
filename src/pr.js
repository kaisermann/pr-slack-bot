require('dotenv').config();

const Github = require('./api/github.js');
const Slack = require('./api/slack.js');
const Metrics = require('./api/metrics.js');
const { EMOJIS, QUICK_ADDITION_LIMIT, NEEDED_REVIEWS } = require('./consts.js');

exports.create = ({
  slug,
  owner,
  repo,
  prID,
  channel,
  ts,
  bot_interactions = {},
  reactions = [],
  state = {},
}) => {
  async function getMessageUrl() {
    Metrics.addCall('slack.chat.getPermalink');
    const response = await Slack.WebClient.chat.getPermalink({
      channel,
      message_ts: ts,
    });

    return response.permalink.replace(/\?.*$/, '');
  }

  // return in minutes
  function timeSincePost() {
    return Math.abs(new Date(ts * 1000) - new Date()) / (1000 * 60);
  }

  // consider in hours
  function needsAttention(hours) {
    return timeSincePost() >= 60 * hours;
  }

  async function reply(id, text) {
    if (bot_interactions[id]) {
      return false;
    }

    console.log(`- Sending reply: ${text}`);
    const response = await Slack.sendMessage(text, channel, ts);
    if (response) {
      bot_interactions[id] = {
        ts: response.ts,
      };
    }
    return bot_interactions[id];
  }

  async function addReaction(name) {
    if (reactions.includes(name)) {
      return false;
    }

    console.log(`- Adding reaction: ${name}`);
    Metrics.addCall('slack.reactions.add');

    return Slack.WebClient.reactions
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
          console.error(e);
        }
        return false;
      });
  }

  async function removeReaction(name) {
    if (!reactions.includes(name)) {
      return false;
    }

    console.log(`- Removing reaction: ${name}`);
    Metrics.addCall('slack.reactions.remove');

    return Slack.WebClient.reactions
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
          console.error(e);
        }
        return false;
      });
  }

  async function update() {
    try {
      const pr = await Github.getPRData(owner, repo, prID);
      const reviewData = await Github.getReviewData(owner, repo, prID);

      // review data mantains a list of reviews
      // we use the last review of an user as the current review state
      const reviewSets = Object.values(
        reviewData.reduce((acc, { user, state: review_state }) => {
          if (!acc[user.login]) acc[user.login] = [];
          acc[user.login].push(review_state);
          return acc;
        }, {}),
      );

      const changesRequested = reviewSets.some(
        set => set.indexOf('CHANGES_REQUESTED') > set.indexOf('APPROVED'),
      );
      const approved =
        !changesRequested &&
        reviewSets.filter(set => set.includes('APPROVED')).length >=
          NEEDED_REVIEWS;

      state = Object.freeze({
        changesRequested,
        approved,
        quick: pr.additions <= QUICK_ADDITION_LIMIT,
        reviewed: pr.review_comments > 0,
        merged: pr.merged,
        mergeable: pr.mergeable,
        dirty: pr.mergeable_state === 'dirty',
        unstable: pr.mergeable_state === 'unstable',
        closed: pr.state === 'closed',
      });

      const changes = {};

      changes.changesRequested = state.changesRequested
        ? await addReaction(EMOJIS.changes)
        : await removeReaction(EMOJIS.changes);

      if (state.quick) {
        changes.quick = await addReaction(EMOJIS.quick_read);
      }

      if (state.reviewed) {
        changes.reviewed = await addReaction(EMOJIS.commented);
      }

      if (state.unstable) {
        changes.unstable = await addReaction(EMOJIS.unstable);
      } else {
        changes.unstable = await removeReaction(EMOJIS.unstable);
      }

      if (state.dirty) {
        changes.dirty = await reply(
          'is_dirty',
          `The branch \`${pr.head.ref}\` is dirty. It may need a rebase with \`${pr.base.ref}\`.`,
        );
      }

      if (state.approved && !state.unstable && !state.merged && !state.closed) {
        changes.ready_to_merge = await reply(
          'ready_to_merge',
          'PR is ready to be merged :doit:!',
        );
      }

      if (state.merged || state.closed) {
        if (state.merged) {
          changes.merged = await addReaction(EMOJIS.merged);
        } else {
          changes.closed = await addReaction(EMOJIS.closed);
        }
      }

      return Promise.all(Object.values(changes)).then(changedResults => {
        return {
          hasChanged: changedResults.some(changed => changed !== false),
          changes,
        };
      });
    } catch (error) {
      console.log(error);
    }

    state = Object.freeze({});
    return {};
  }

  function toJSON() {
    return {
      slug,
      owner,
      repo,
      prID,
      channel,
      ts,
      reactions,
      bot_interactions,
    };
  }

  return Object.freeze({
    // props
    slug,
    owner,
    repo,
    prID,
    channel,
    ts,
    // methods
    get state() {
      return state;
    },
    get hoursSincePost() {
      return ~~(timeSincePost() / 60);
    },
    toJSON,
    addReaction,
    removeReaction,
    update,
    getMessageUrl,
    timeSincePost,
    reply,
    needsAttention,
  });
};
