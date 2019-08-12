const Octokit = require('@octokit/rest');

const Logger = require('./logger.js');
const Balancer = require('../balancer.js');

const REQUEST_SIGNATURES = {};

const create_signature = props => JSON.stringify(props);

const get_request_signature = request_options => {
  if (request_options.etag_signature) {
    return create_signature(request_options.etag_signature);
  }

  const signature_obj = Object.assign({}, request_options);
  delete signature_obj.request;
  delete signature_obj.headers;
  delete signature_obj.mediaType;
  delete signature_obj.baseUrl;
  delete signature_obj.method;
  delete signature_obj.url;

  return create_signature(signature_obj);
};

const has_cached_signature = (url, signature) => {
  return url in REQUEST_SIGNATURES && signature in REQUEST_SIGNATURES[url];
};

const get_cached_signature = (url, signature) => {
  if (!has_cached_signature(url, signature)) return null;
  return REQUEST_SIGNATURES[url][signature];
};

const etag_plugin = (octokit, octokit_options = {}) => {
  const { cache_limiter } = octokit_options.etag || {};

  octokit.invalidate_etag_signature = signature_props => {
    const signature = create_signature(signature_props);
    Object.values(REQUEST_SIGNATURES).forEach(signatures => {
      if (signature in signatures) {
        delete signatures[signature];
      }
    });
  };

  if (typeof cache_limiter === 'function') {
    cache_limiter(REQUEST_SIGNATURES);
  }

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

const github_client = Octokit.plugin([etag_plugin])({
  auth: process.env.GITHUB_TOKEN,
  etag: {
    cache_limiter(signature_cache) {
      const MAX_PER_URL = 100;
      const INTERVAL = 60 * 60 * 60; // one hour
      setInterval(() => {
        Object.entries(signature_cache).forEach(([url, signatures]) => {
          const keys = Object.keys(signatures);

          if (keys.length <= MAX_PER_URL) return;

          const begin_index = Math.max(0, keys.length - 1 - MAX_PER_URL);
          const end_index = begin_index + MAX_PER_URL;
          signature_cache[url] = keys
            .slice(begin_index, end_index)
            .reduce((acc, key) => {
              acc[key] = signatures[key];
              return acc;
            }, {});
        });
      }, INTERVAL);
    },
  },
});

exports.client = github_client;

exports.get_pr_data = (owner, repo, pull_number, etag_signature) => {
  return Balancer.Github.request(() => {
    return github_client.pulls
      .get({
        owner,
        repo,
        pull_number,
        etag_signature,
      })
      .then(({ status, data }) => {
        Logger.add_call(`github.pulls.get.${status}`);
        return { status, data };
      });
  }, `data${owner}${repo}${pull_number}`);
};

exports.get_review_data = (owner, repo, pull_number, etag_signature) => {
  return Balancer.Github.request(() => {
    return github_client.pulls
      .listReviews({
        owner,
        repo,
        pull_number,
        etag_signature,
      })
      .then(({ status, data }) => {
        Logger.add_call(`github.pulls.listReviews.${status}`);
        return { status, data };
      });
  }, `review${owner}${repo}${pull_number}`);
};

exports.get_pr_files = (owner, repo, pull_number, etag_signature) => {
  return Balancer.Github.request(() => {
    return github_client.pulls
      .listFiles({
        owner,
        repo,
        pull_number,
        per_page: 300,
        etag_signature,
      })
      .then(({ status, data }) => {
        Logger.add_call(`github.pulls.listFiles.${status}`);
        return { status, data };
      });
  }, `listFiles${owner}${repo}${pull_number}`);
};
