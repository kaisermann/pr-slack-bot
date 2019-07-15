const Octokit = require('@octokit/rest');

const Logger = require('./logger.js');
const Balancer = require('../balancer.js');

const github_client = Octokit({
  auth: process.env.GITHUB_TOKEN,
});

exports.github_client = github_client;

exports.get_pr_data = (owner, repo, pull_number) => {
  return Balancer.Github.request(
    () => {
      Logger.add_call('github.pulls.get');
      return github_client.pulls
        .get({
          owner,
          repo,
          pull_number,
        })
        .then(response => response.data);
    },
    `data${owner}${repo}${pull_number}`,
    'get_pr_data',
  );
};

exports.get_review_data = (owner, repo, pull_number) => {
  return Balancer.Github.request(
    () => {
      Logger.add_call('github.pulls.listReviews');
      return github_client.pulls
        .listReviews({
          owner,
          repo,
          pull_number,
        })
        .then(response => response.data);
    },
    `review${owner}${repo}${pull_number}`,
    'get_review_data',
  );
};
