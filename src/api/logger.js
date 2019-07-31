// const { createWriteStream } = require('fs');

let calls = {};
// const log_stream = createWriteStream('out.log', { flags: 'a' });
const log = (...args) => {
  // log_stream.write(
  //   `[${new Date().toISOString()}] ${args
  //     .map(arg => JSON.stringify(arg))
  //     .join(' ')}\n`,
  // );
  console.log(...args);
};

exports.log = log;

exports.add_call = method => {
  calls[method] = (calls[method] || 0) + 1;
};

exports.log_metrics = () => {
  log('API call metrics:');
  Object.entries(calls).forEach(([method, count]) => {
    log(`- ${method}: ${count} times`);
  });
};

exports.reset_metrics = () => {
  calls = {};
};

exports.log_error = (...args) => {
  console.error(...args);
};

exports.log_pr_action = (...args) => {
  log('-', ...args);
};
