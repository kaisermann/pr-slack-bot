const Octokit = require('@octokit/rest');

const Metrics = require('./metrics.js');

const GithubClient = Octokit({
  auth: process.env.GITHUB_TOKEN,
});

exports.GithubClient = GithubClient;

exports.getPRData = async (owner, repo, pull_number) => {
  Metrics.addCall('github.pulls.get');

  return (await GithubClient.pulls.get({
    owner,
    repo,
    pull_number,
  })).data;
};

exports.getReviewData = async (owner, repo, pull_number) => {
  Metrics.addCall('github.pulls.listReviews');

  return (await GithubClient.pulls.listReviews({
    owner,
    repo,
    pull_number,
  })).data;
};
