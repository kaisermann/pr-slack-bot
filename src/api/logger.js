let calls = {};

exports.add_call = method => {
  calls[method] = (calls[method] || 0) + 1;
};

exports.log_metrics = () => {
  console.log('API call metrics:');
  Object.entries(calls).forEach(([method, count]) => {
    console.log(`- ${method}: ${count} times`);
  });
};

exports.reset_metrics = () => {
  calls = {};
};

exports.log = (...args) => {
  console.log(...args);
};

exports.log_error = (...args) => {
  console.error(...args);
};

exports.log_pr_action = (...args) => {
  console.log('-', ...args);
};
