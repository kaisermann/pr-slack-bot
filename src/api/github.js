const Octokit = require('@octokit/rest');

const Logger = require('./logger.js');

const github_client = Octokit({
  auth: process.env.GITHUB_TOKEN,
});

exports.github_client = github_client;

exports.get_pr_data = async (owner, repo, pull_number) => {
  Logger.add_call('github.pulls.get');

  return (await github_client.pulls.get({
    owner,
    repo,
    pull_number,
  })).data;
};

exports.get_review_data = async (owner, repo, pull_number) => {
  Logger.add_call('github.pulls.listReviews');

  return (await github_client.pulls.listReviews({
    owner,
    repo,
    pull_number,
  })).data;
};
