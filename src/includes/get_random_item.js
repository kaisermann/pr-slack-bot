const random = require('./get_random.js');

module.exports = arr => arr[random(0, arr.length - 1)];
