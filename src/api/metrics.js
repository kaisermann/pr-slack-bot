let calls = {};

exports.add_call = method => {
  calls[method] = (calls[method] || 0) + 1;
};

exports.log = () => {
  console.log('API call metrics:');
  Object.entries(calls).forEach(([method, count]) => {
    console.log(`- ${method}: ${count} times`);
  });
};

exports.reset = () => {
  calls = {};
};
