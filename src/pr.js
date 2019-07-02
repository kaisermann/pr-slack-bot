require('dotenv').config();

const { github } = require('./github.js');
const { WebClient } = require('./slack.js');

exports.addReaction = async (name, meta) => {
  if (meta.reactions.includes(name)) {
    return;
  }

  console.log(`Adding reaction: ${name}`);

  meta.reactions.push(name);

  return WebClient.reactions.add({
    name,
    timestamp: meta.timestamp,
    channel: meta.channel,
  });
};

exports.createPR = ({ slug, user, repo, prID, channel, timestamp }) => {
  try {
    return {
      slug,
      prID,
      user,
      repoName: repo,
      channel,
      timestamp,
      reactions: [],
    };
  } catch (error) {
    console.error(error);
  }
};

exports.checkPR = async meta => {
  const result = {};

  try {
    const pr = await github.pulls.get({
      owner: meta.user,
      repo: meta.repoName,
      pull_number: meta.prID,
    });

    if (pr.data.additions < 80) {
      result.quick = true;
    }

    if (pr.data.review_comments > 0) {
      result.reviewed = true;
    }

    if (pr.data.merged) {
      result.merged = true;
    }
  } catch (error) {
    console.log(error);
  }

  return result;
};
