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

exports.createPR = ({ slug, user, repo, prID, channel, timestamp }) => {
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

exports.checkPR = async meta => {
  try {
    const pr = await GithubClient.pulls.get({
      owner: meta.user,
      repo: meta.repoName,
      pull_number: meta.prID,
    });

    const reviews = await GithubClient.pulls.listReviews({
      owner: meta.user,
      repo: meta.repoName,
      pull_number: meta.prID,
    });

    const changesRequested = reviews.data.some(
      r => r.state === 'CHANGES_REQUESTED',
    );
    const approved =
      reviews.data.filter(r => r.state === 'APPROVED').length >= NEEDED_REVIEWS;

    const minutesSinceMessage =
      Math.abs(new Date(meta.timestamp * 1000) - new Date()) / (1000 * 60);

    const result = {
      changesRequested,
      approved,
      quick: pr.data.additions <= QUICK_ADDITION_LIMIT,
      reviewed: pr.data.review_comments > 0,
      merged: pr.data.merged,
      needsAttention: minutesSinceMessage >= MINUTES_TO_NEED_ATTENTION,
      closed: pr.data.state === 'closed',
    };

    console.log(`Checking: ${meta.slug}`);
    console.log(`- Quick PR: ${result.quick}`);
    console.log(`- Changes Requested: ${result.changesRequested}`);
    console.log(`- Approved: ${result.approved}`);
    console.log(`- Has review comments: ${result.reviewed}`);
    console.log(`- Merged: ${result.merged}`);
    console.log(`- Posted ${minutesSinceMessage} minutes ago`);

    return result;
  } catch (error) {
    console.log(error);
  }

  return {};
};
