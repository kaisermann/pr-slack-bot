const Octokit = require('@octokit/rest');

exports.GithubClient = Octokit({
  auth: process.env.GITHUB_TOKEN,
});
