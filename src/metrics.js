let calls = {};

exports.addCall = method => {
  calls[method] = (calls[method] || 0) + 1;
};

exports.log = () => {
  Object.entries(calls).forEach(([method, count]) => {
    console.log(`${method}: ${count} times`);
  });
};

exports.reset = () => {
  calls = {};
};
