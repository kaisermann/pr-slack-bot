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
      // we want 10 requests per second
      rate: 30,
      limit: 1,
      priority: 1,
    },
  },
  retryTime: 300,
  ignoreOverallOverheat: true,
});
