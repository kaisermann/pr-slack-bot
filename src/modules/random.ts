// Kudos for http://dimitri.xyz/random-ints-from-random-bits/
import crypto from 'crypto'

// 32 bit maximum / 2^32
const maxRange = 4294967296
const getRandSample = () => crypto.randomBytes(4).readUInt32LE(0)
const unsafeCoerce = (sample: number, range: number) => sample % range
const inExtendedRange = (sample: number, range: number) =>
  sample < Math.floor(maxRange / range) * range

/* extended range rejection sampling */
const maxIter = 100

function rejectionSampling(
  range: number,
  inRange: Function,
  coerce: (...args: any[]) => number
) {
  let sample
  let i = 0

  do {
    sample = getRandSample()
    if (i >= maxIter) {
      // do some error reporting.
      console.log('Too many iterations. Check your source of randomness.')
      break /* just returns biased sample using remainder */
    }

    i++
  } while (!inRange(sample, range))

  return coerce(sample, range)
}

// returns random value in interval [0,range) -- excludes the upper bound
const getRandIntLessThan = (range: number) =>
  rejectionSampling(Math.ceil(range), inExtendedRange, unsafeCoerce)

// returned value is in interval [low, high] -- upper bound is included
export function getRandomBetween(low: number, hi: number) {
  if (low > hi) {
    throw new Error('lower value can be bigger than higher value')
  }

  // make also work for fractional arguments
  const l = Math.ceil(low)
  // there must be an integer in the interval
  const h = Math.floor(hi)

  return l + getRandIntLessThan(h - l + 1)
}

export function getRandomItem<T>(iterable: Iterable<T>) {
  const array = Array.from(iterable)

  return array[getRandomBetween(0, array.length - 1)]
}
