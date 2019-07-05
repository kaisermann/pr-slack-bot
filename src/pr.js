require('dotenv').config();

const Github = require('./github.js');
const Slack = require('./slack.js');
const Metrics = require('./metrics.js');
const { EMOJIS } = require('./consts.js');

const QUICK_ADDITION_LIMIT = 80;
const NEEDED_REVIEWS = 2;

exports.create = ({
  slug,
  owner,
  repo,
  prID,
  channel,
  timestamp,
  bot_interactions = {},
  reactions = [],
  state = {},
}) => {
  async function getMessageUrl() {
    Metrics.addCall('slack.chat.getPermalink');
    const response = await Slack.Slack.WebClient.chat.getPermalink({
      channel,
      message_ts: timestamp,
    });

    return response.permalink.replace(/\?.*$/, '');
  }

  // return in minutes
  function timeSincePost() {
    return Math.abs(new Date(timestamp * 1000) - new Date()) / (1000 * 60);
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
    bot_interactions[id] = true;

    return Slack.sendMessage(text, channel, timestamp);
  }

  async function addReaction(name) {
    if (reactions.includes(name)) {
      return false;
    }

    console.log(`- Adding reaction: ${name}`);
    Metrics.addCall('slack.reactions.add');

    return Slack.WebClient.reactions
      .add({ name, timestamp, channel })
      .then(() => {
        reactions.push(name);
      })
      .catch(e => {
        if (e.data.error === 'already_reacted') {
          reactions.push(name);
        }

        if (process.env.NODE_ENV !== 'production') {
          console.error(e);
        }
      });
  }

  async function removeReaction(name) {
    if (!reactions.includes(name)) {
      return false;
    }

    console.log(`- Removing reaction: ${name}`);
    Metrics.addCall('slack.reactions.remove');

    return Slack.WebClient.reactions
      .remove({ name, timestamp, channel })
      .then(() => {
        reactions = reactions.filter(r => r !== name);
      })
      .catch(e => {
        if (e.data.error === 'no_reaction') {
          reactions = reactions.filter(r => r !== name);
        }

        if (process.env.NODE_ENV !== 'production') {
          console.error(e);
        }
      });
  }

  async function update() {
    try {
      const pr = await Github.getPRData(owner, repo, prID);
      const reviewData = await Github.getReviewData(owner, repo, prID);

      // review data mantains a list of reviews
      // we use the last review of an user as the current review state
      const reviews = Object.values(
        reviewData.reduce((acc, { user, state: review_state }) => {
          acc[user.login] = review_state;
          return acc;
        }, {}),
      );

      const changesRequested = reviews.some(
        review_state => review_state === 'CHANGES_REQUESTED',
      );
      const approved =
        reviews.filter(review_state => review_state === 'APPROVED').length >=
        NEEDED_REVIEWS;

      state = Object.freeze({
        changesRequested,
        approved,
        quick: pr.additions <= QUICK_ADDITION_LIMIT,
        reviewed: pr.review_comments > 0,
        merged: pr.merged,
        unstable: pr.mergeable_state === 'unstable',
        closed: pr.state === 'closed',
      });

      const tasks = [];

      if (state.changesRequested) {
        tasks.push(await addReaction(EMOJIS.changes));
      } else {
        tasks.push(await removeReaction(EMOJIS.changes));
      }

      if (state.quick) {
        tasks.push(await addReaction(EMOJIS.quick_read));
      }

      if (state.reviewed) {
        tasks.push(await addReaction(EMOJIS.commented));
      }

      if (state.unstable) {
        tasks.push(await addReaction(EMOJIS.unstable));
      } else {
        tasks.push(await removeReaction(EMOJIS.unstable));
      }

      if (state.approved && !state.unstable && !state.merged && !state.closed) {
        tasks.push(
          await reply('ready_to_merge', 'PR is ready to be merged :doit:!'),
        );
      }

      if (state.merged || state.closed) {
        if (state.merged) {
          tasks.push(await addReaction(EMOJIS.merged));
        } else {
          tasks.push(await addReaction(EMOJIS.closed));
        }
      }

      return Promise.all(tasks).then(changedResults => {
        return changedResults.some(changed => changed !== false);
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
      timestamp,
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
    timestamp,
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
