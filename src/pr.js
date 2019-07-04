require('dotenv').config();

const { GithubClient } = require('./github.js');
const { SlackWebClient, sendMessage } = require('./slack.js');

const QUICK_ADDITION_LIMIT = 80;
const NEEDED_REVIEWS = 2;

exports.addReaction = async (name, meta) => {
  if (meta.reactions.includes(name)) {
    return;
  }

  console.log(`-- Adding reaction: ${name}`);

  meta.reactions.push(name);

  return SlackWebClient.reactions.add({
    name,
    timestamp: meta.timestamp,
    channel: meta.channel,
  });
};
exports.removeReaction = async (name, meta) => {
  if (!meta.reactions.includes(name)) {
    return;
  }

  console.log(`-- Removing reaction: ${name}`);

  meta.reactions = meta.reactions.filter(r => r !== name);

  return SlackWebClient.reactions.remove({
    name,
    timestamp: meta.timestamp,
    channel: meta.channel,
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

    const pr = (await GithubClient.pulls.get({
      owner,
      repo,
      pull_number,
    })).data;

    const reviewData = (await GithubClient.pulls.listReviews({
      owner,
      repo,
      pull_number,
    })).data;

    // review data mantains both change request and approved
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

    console.log(`Checking: ${meta.slug} | ${meta.channel} | ${meta.timestamp}`);
    console.log(`- Quick PR: ${result.quick}`);
    console.log(`- Changes Requested: ${result.changesRequested}`);
    console.log(`- Approved: ${result.approved}`);
    console.log(`- Has review comments: ${result.reviewed}`);
    console.log(`- Unstable: ${result.unstable}`);
    console.log(`- Merged: ${result.merged}`);
    console.log(
      `- Posted ${parseInt(exports.timeSincePost(meta) / 60, 10)} hours ago`,
    );

    return result;
  } catch (error) {
    console.log(error);
  }

  return {};
};

exports.getMessageUrl = async meta => {
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

exports.sendMessage = (meta, id, text) => {
  if (!exports.hasInteracted(meta, id)) {
    meta.bot_interactions[id] = true;
    sendMessage(text, meta.channel, meta.timestamp);
  }
};
