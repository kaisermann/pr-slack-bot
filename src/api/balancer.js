const Queue = require('smart-request-balancer');

module.exports = new Queue({
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
  ignoreOverallOverheat: true,
});
