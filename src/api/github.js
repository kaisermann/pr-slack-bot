const { App } = require('@octokit/app');
const { request } = require('@octokit/request');

const Logger = require('./logger.js');
const db = require('../api/db.js');

const github_app = new App(
  process.env.NODE_ENV === 'production'
    ? {
        id: process.env.APP_ID,
        privateKey: process.env.APP_PRIVATE_KEY,
      }
    : {
        id: process.env.DEV_APP_ID,
        privateKey: process.env.DEV_APP_PRIVATE_KEY,
      },
);

let jwt_token = github_app.getSignedJsonWebToken();
// renew after 9:30 mins
setInterval(() => {
  jwt_token = github_app.getSignedJsonWebToken();
}, 1000 * (60 * 10 - 30));

const REQUEST_SIGNATURES = {};
const get_request_signature = options => {
  if (options.etag_signature) {
    return JSON.stringify(options.etag_signature);
  }
  return JSON.stringify(options);
};

const get_cached_etag = (url, signature) => {
  if (!(url in REQUEST_SIGNATURES && signature in REQUEST_SIGNATURES[url]))
    return null;
  return REQUEST_SIGNATURES[url][signature];
};

exports.invalidate_etag_signature = signature_props => {
  const signature = get_request_signature(signature_props);
  Object.values(REQUEST_SIGNATURES).forEach(signatures => {
    if (signature in signatures) {
      delete signatures[signature];
    }
  });
};

const get_installation_id = async repo_full_name => {
  const { data } = await request(`GET /repos/${repo_full_name}/installation`, {
    headers: {
      authorization: `Bearer ${jwt_token}`,
      accept: 'application/vnd.github.machine-man-preview+json',
    },
  });
  return data.id;
};

const gh_request = async (url, options) => {
  const full_name = `${options.owner}/${options.repo}`;
  const request_headers = { ...options.headers };
  let installationId = db.installations.get_id(full_name);

  const request_signature = get_request_signature(options);

  if (!(url in REQUEST_SIGNATURES)) {
    REQUEST_SIGNATURES[url] = {};
  }

  const cached_signature = get_cached_etag(url, request_signature);
  if (cached_signature != null) {
    request_headers['If-None-Match'] = cached_signature;
  }

  if (installationId == null) {
    installationId = await get_installation_id(full_name);
    db.installations.set_id(full_name, installationId);
  }

  try {
    const installationAccessToken = await github_app.getInstallationAccessToken(
      { installationId },
    );

    const response = await request(url, {
      ...options,
      headers: {
        ...request_headers,
        authorization: `token ${installationAccessToken}`,
      },
    });

    const { etag } = response.headers;
    REQUEST_SIGNATURES[url][request_signature] = etag;

    return response;
  } catch (e) {
    return e;
  }
};

exports.get_pr_data = ({ owner, repo, pr_id: pull_number, etag_signature }) => {
  return gh_request('GET /repos/:owner/:repo/pulls/:pull_number', {
    owner,
    repo,
    pull_number,
    etag_signature,
  }).then(({ status, data }) => {
    Logger.add_call(`github.pulls.get.${status}`);
    return { status, data };
  });
};

exports.get_review_data = ({
  owner,
  repo,
  pr_id: pull_number,
  etag_signature,
}) => {
  return gh_request('GET /repos/:owner/:repo/pulls/:pull_number/reviews', {
    owner,
    repo,
    pull_number,
    etag_signature,
  }).then(({ status, data }) => {
    Logger.add_call(`github.pulls.listReviews.${status}`);
    return { status, data };
  });
};

exports.get_files_data = ({
  owner,
  repo,
  pr_id: pull_number,
  etag_signature,
}) => {
  return gh_request('GET /repos/:owner/:repo/pulls/:pull_number/files', {
    owner,
    repo,
    pull_number,
    etag_signature,
    per_page: 300,
  }).then(({ status, data }) => {
    Logger.add_call(`github.pulls.listFiles.${status}`);
    return { status, data };
  });
};
