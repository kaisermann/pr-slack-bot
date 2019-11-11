const random = require('./get_random.js');

module.exports = iterable => {
  const array = Array.from(iterable);
  return array[random(0, array.length - 1)];
};
