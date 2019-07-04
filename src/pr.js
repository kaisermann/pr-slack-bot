require('dotenv').config();

const { GithubClient } = require('./github.js');
const { WebClient } = require('./slack.js');

const MINUTES_TO_NEED_ATTENTION = 60;
const QUICK_ADDITION_LIMIT = 80;
const NEEDED_REVIEWS = 2;

exports.addReaction = async (name, meta) => {
  if (meta.reactions.includes(name)) {
    return;
  }

  console.log(`-- Adding reaction: ${name}`);

  meta.reactions.push(name);

  return WebClient.reactions.add({
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

  return WebClient.reactions.remove({
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
  };
};

exports.check = async meta => {
  try {
    const owner = meta.user;
    const repo = meta.repoName;
    const pull_number = meta.prID;

    const pr = await GithubClient.pulls.get({
      owner,
      repo,
      pull_number,
    });

    const reviews = await GithubClient.pulls.listReviews({
      owner,
      repo,
      pull_number,
    });

    const changesRequested = reviews.data.some(
      r => r.state === 'CHANGES_REQUESTED',
    );
    const approved =
      reviews.data.filter(r => r.state === 'APPROVED').length >= NEEDED_REVIEWS;

    const result = {
      changesRequested,
      approved,
      quick: pr.data.additions <= QUICK_ADDITION_LIMIT,
      reviewed: pr.data.review_comments > 0,
      merged: pr.data.merged,
      unstable: pr.data.mergeable_state === 'unstable',
      closed: pr.data.state === 'closed',
    };

    console.log(`Checking: ${meta.slug} | ${meta.channel} | ${meta.timestamp}`);
    console.log(`- Quick PR: ${result.quick}`);
    console.log(`- Changes Requested: ${result.changesRequested}`);
    console.log(`- Approved: ${result.approved}`);
    console.log(`- Has review comments: ${result.reviewed}`);
    console.log(`- Unstable: ${result.unstable}`);
    console.log(`- Merged: ${result.merged}`);
    console.log(`- Posted ${exports.timeSincePost(meta)} minutes ago`);

    return result;
  } catch (error) {
    console.log(error);
  }

  return {};
};

exports.getMessageUrl = async meta => {
  const response = await WebClient.chat.getPermalink({
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
