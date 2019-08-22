const { cyan, yellow, red, greenBright } = require('colorette');

let calls = {};

const now = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, -1);
};
const log = (...args) => console.log(`[${now()}]`, ...args);
const error = (...args) => console.error(`[${now()}]`, ...args);

module.exports = {
  log: (...args) => log(...args),
  info: (...args) => log(cyan(args.join(' '))),
  warn: (...args) => log(yellow(args.join(' '))),
  error: (err, msg) => error(`${red(`${msg}\n${err.stack}`)}`),
  success: (...args) => log(greenBright(args.join(' '))),
  add_call: method => {
    // calls[method] = (calls[method] || 0) + 1;
  },
};
