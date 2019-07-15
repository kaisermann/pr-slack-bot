const Octokit = require('@octokit/rest');
const throttling = require('@octokit/plugin-throttling');
const retry = require('@octokit/plugin-retry');

const Logger = require('./logger.js');
// const Balancer = require('../balancer.js');

const github_client = Octokit.plugin([throttling, retry])({
  auth: process.env.GITHUB_TOKEN,
  throttle: {
    onRateLimit: (retryAfter, options) => {
      github_client.log.warn(
        `Request quota exhausted for request ${options.method} ${options.url}`,
      );

      if (options.request.retryCount === 0) {
        // only retries once
        console.log(`Retrying after ${retryAfter} seconds!`);
        return true;
      }
    },
    onAbuseLimit: (retryAfter, options) => {
      // does not retry, only logs a warning
      github_client.log.warn(
        `Abuse detected for request ${options.method} ${options.url}`,
      );
    },
  },
});

exports.github_client = github_client;

exports.get_pr_data = (owner, repo, pull_number) => {
  // return Balancer.Github.request(
  //   () => {
  Logger.add_call('github.pulls.get');
  return github_client.pulls
    .get({
      owner,
      repo,
      pull_number,
    })
    .then(response => response.data);
  //   },
  //   `data${owner}${repo}${pull_number}`,
  //   'get_pr_data',
  // );
};

exports.get_review_data = (owner, repo, pull_number) => {
  // return Balancer.Github.request(
  //   () => {
  Logger.add_call('github.pulls.listReviews');
  return github_client.pulls
    .listReviews({
      owner,
      repo,
      pull_number,
    })
    .then(response => response.data);
  //   },
  //   `review${owner}${repo}${pull_number}`,
  //   'get_review_data',
  // );
};
