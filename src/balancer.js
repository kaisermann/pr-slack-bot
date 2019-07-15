const Queue = require('smart-request-balancer');

exports.Slack = new Queue({
  rules: {
    common: {
      rate: 50,
      limit: 60,
      priority: 5,
    },
    get_user_info: {
      rate: 500,
      limit: 60,
      priority: 10,
    },
  },
  retryTime: 300,
});

exports.Github = new Queue({
  rules: {
    common: {
      rate: 5000,
      limit: 60 * 60,
      priority: 5,
    },
  },
  retryTime: 300,
});
