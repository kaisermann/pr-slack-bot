const Octokit = require('@octokit/rest');

exports.github = Octokit({
  auth: process.env.GITHUB_TOKEN,
});
