const { cyan, yellow, red } = require('colorette');

let calls = {};

const now = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, -1);
};
const log = (...args) => console.log(`[${now()}] ${args.join(' ')}`);

module.exports = {
  info: (...args) => log(cyan(...args)),
  warn: (...args) => log(yellow(...args)),
  error: (...args) => log(red(...args)),
  add_call: method => {
    // calls[method] = (calls[method] || 0) + 1;
  },
};
