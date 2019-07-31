const Octokit = require('@octokit/rest');
const throttling = require('@octokit/plugin-throttling');
const retry = require('@octokit/plugin-retry');

const Logger = require('./logger.js');
const Balancer = require('../balancer.js');

const REQUEST_SIGNATURES = {};

const get_request_signature = request_options => {
  const signature_obj = Object.assign({}, request_options);
  delete signature_obj.request;
  delete signature_obj.headers;
  delete signature_obj.mediaType;
  delete signature_obj.baseUrl;
  delete signature_obj.method;
  delete signature_obj.url;

  return JSON.stringify(signature_obj);
};

const has_cached_signature = (url, signature) => {
  return url in REQUEST_SIGNATURES && signature in REQUEST_SIGNATURES[url];
};

const get_cached_signature = (url, signature) => {
  if (!has_cached_signature(url, signature)) return null;
  return REQUEST_SIGNATURES[url][signature];
};

const etag_plugin = octokit => {
  octokit.hook.wrap('request', async (request_fn, request_options) => {
    const request_url = request_options.url;
    const request_signature = get_request_signature(request_options);

    if (!(request_url in REQUEST_SIGNATURES)) {
      REQUEST_SIGNATURES[request_url] = {};
    }

    const cached_signature = get_cached_signature(
      request_url,
      request_signature,
    );

    if (cached_signature != null) {
      request_options.headers['If-None-Match'] = cached_signature;
    }

    try {
      const response = await request_fn(request_options);
      const { etag } = response.headers;

      REQUEST_SIGNATURES[request_url][request_signature] = etag;

      return response;
    } catch (e) {
      return e;
    }
  });
};

const github_client = Octokit.plugin([throttling, retry, etag_plugin])({
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
  return Balancer.Github.request(
    () => {
      return github_client.pulls
        .get({
          owner,
          repo,
          pull_number,
        })
        .then(({ status, data }) => {
          Logger.add_call(`github.pulls.get.${status}`);
          return { status, data };
        });
    },
    `data${owner}${repo}${pull_number}`,
    'get_pr_data',
  );
};

exports.get_review_data = (owner, repo, pull_number) => {
  return Balancer.Github.request(
    () => {
      return github_client.pulls
        .listReviews({
          owner,
          repo,
          pull_number,
        })
        .then(({ status, data }) => {
          Logger.add_call(`github.pulls.listReviews.${status}`);
          return { status, data };
        });
    },
    `review${owner}${repo}${pull_number}`,
    'get_review_data',
  );
};
