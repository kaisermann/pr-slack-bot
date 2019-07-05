require('dotenv').config();

const { GithubClient } = require('./github.js');
const { SlackWebClient, sendMessage } = require('./slack.js');
const Metrics = require('./metrics.js');

const QUICK_ADDITION_LIMIT = 80;
const NEEDED_REVIEWS = 2;

exports.addReaction = async (name, meta) => {
  if (meta.reactions.includes(name)) {
    return;
  }

  console.log(`-- Adding reaction: ${name}`);
  Metrics.addCall('slack.reactions.add');

  return SlackWebClient.reactions
    .add({
      name,
      timestamp: meta.timestamp,
      channel: meta.channel,
    })
    .then(() => {
      meta.reactions.push(name);
    })
    .catch(e => {
      if (e.data.error === 'already_reacted') {
        meta.reactions.push(name);
      }

      if (process.env.NODE_ENV !== 'production') {
        console.error(e);
      }
    });
};
exports.removeReaction = async (name, meta) => {
  if (!meta.reactions.includes(name)) {
    return;
  }

  console.log(`-- Removing reaction: ${name}`);
  Metrics.addCall('slack.reactions.remove');

  return SlackWebClient.reactions
    .remove({
      name,
      timestamp: meta.timestamp,
      channel: meta.channel,
    })
    .then(() => {
      meta.reactions = meta.reactions.filter(r => r !== name);
    })
    .catch(e => {
      if (e.data.error === 'no_reaction') {
        meta.reactions = meta.reactions.filter(r => r !== name);
      }

      if (process.env.NODE_ENV !== 'production') {
        console.error(e);
      }
    });
};

exports.create = ({ slug, user, repo, prID, channel, timestamp }) => {
  return {
    slug,
    prID,
    user,
    repoName: repo,
    channel,
    timestamp,
    reactions: [],
    bot_interactions: {},
  };
};

exports.check = async meta => {
  try {
    const owner = meta.user;
    const repo = meta.repoName;
    const pull_number = meta.prID;

    Metrics.addCall('github.pulls.get');
    const pr = (await GithubClient.pulls.get({
      owner,
      repo,
      pull_number,
    })).data;

    Metrics.addCall('github.pulls.listReviews');
    const reviewData = (await GithubClient.pulls.listReviews({
      owner,
      repo,
      pull_number,
    })).data;

    // review data mantains a list of reviews
    // we use the last review of an user as the current review state
    const reviews = Object.values(
      reviewData.reduce((acc, { user, state }) => {
        acc[user.login] = state;
        return acc;
      }, {}),
    );

    const changesRequested = reviews.some(
      state => state === 'CHANGES_REQUESTED',
    );
    const approved =
      reviews.filter(state => state === 'APPROVED').length >= NEEDED_REVIEWS;

    const result = {
      changesRequested,
      approved,
      quick: pr.additions <= QUICK_ADDITION_LIMIT,
      reviewed: pr.review_comments > 0,
      merged: pr.merged,
      unstable: pr.mergeable_state === 'unstable',
      closed: pr.state === 'closed',
    };

    console.log(
      `Checking: ${meta.slug} | ${meta.channel} | ${meta.timestamp} (${parseInt(
        exports.timeSincePost(meta) / 60,
        10,
      )} hours ago)`,
    );

    return result;
  } catch (error) {
    console.log(error);
  }

  return {};
};

exports.getMessageUrl = async meta => {
  Metrics.addCall('slack.chat.getPermalink');
  const response = await SlackWebClient.chat.getPermalink({
    channel: meta.channel,
    message_ts: meta.timestamp,
  });

  return response.permalink.replace(/\?.*$/, '');
};

// return in minutes
exports.timeSincePost = meta =>
  Math.abs(new Date(meta.timestamp * 1000) - new Date()) / (1000 * 60);

// consider in hours
exports.needsAttention = (meta, hours) =>
  exports.timeSincePost(meta) >= 60 * hours;

exports.hasInteracted = (meta, id) => !!meta.bot_interactions[id];

exports.sendMessage = async (meta, id, text) => {
  if (exports.hasInteracted(meta, id)) {
    return;
  }

  console.log(`-- Sending reply: ${text}`);
  meta.bot_interactions[id] = true;

  return sendMessage(text, meta.channel, meta.timestamp);
};
