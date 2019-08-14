const assert = require('assert');

// Async mutex lock
module.exports = class AsyncLock {
  constructor() {
    this.acquired = false;
    this.awaiting_resolvers = [];
  }

  acquire() {
    if (!this.acquired) {
      this.acquired = true;
      return Promise.resolve();
    }

    return new Promise(resolve => {
      this.awaiting_resolvers.push(resolve);
    });
  }

  release() {
    assert(this.acquired, 'Trying to release an unacquired lock');
    if (this.awaiting_resolvers.length > 0) {
      let resolve = this.awaiting_resolvers.shift();
      resolve();
    } else {
      this.acquired = false;
    }
  }
};
