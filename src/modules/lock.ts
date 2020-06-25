import assert from 'assert'

// Async mutex lock
export class AsyncLock {
  private _acquired: boolean
  private awaitingResolvers: Function[]

  constructor() {
    this._acquired = false
    this.awaitingResolvers = []
  }

  public acquire() {
    if (!this._acquired) {
      this._acquired = true

      return Promise.resolve()
    }

    return new Promise((resolve) => {
      this.awaitingResolvers.push(resolve)
    })
  }

  public get acquired() {
    return this._acquired
  }

  public release() {
    assert(this._acquired, 'Trying to release an unacquired lock')
    if (this.awaitingResolvers.length > 0) {
      const resolve = this.awaitingResolvers.shift()

      resolve?.()
    } else {
      this._acquired = false
    }
  }
}
