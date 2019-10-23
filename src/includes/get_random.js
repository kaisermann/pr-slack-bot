// Kudos for http:// dimitri.xyz/random-ints-from-random-bits/
const crypto = require('crypto');

// 32 bit maximum
const maxRange = 4294967296; // 2^32
const getRandSample = () => crypto.randomBytes(4).readUInt32LE();
const unsafeCoerce = (sample, range) => sample % range;
const inExtendedRange = (sample, range) =>
  sample < Math.floor(maxRange / range) * range;

/* extended range rejection sampling */
const maxIter = 100;

function rejectionSampling(range, inRange, coerce) {
  let sample;
  let i = 0;
  do {
    sample = getRandSample();
    if (i >= maxIter) {
      // do some error reporting.
      console.log('Too many iterations. Check your source of randomness.');
      break; /* just returns biased sample using remainder */
    }
    i++;
  } while (!inRange(sample, range));
  return coerce(sample, range);
}

// returns random value in interval [0,range) -- excludes the upper bound
const getRandIntLessThan = range =>
  rejectionSampling(Math.ceil(range), inExtendedRange, unsafeCoerce);

// returned value is in interval [low, high] -- upper bound is included
module.exports = (low, hi) => {
  if (low <= hi) {
    const l = Math.ceil(low); // make also work for fractional arguments
    const h = Math.floor(hi); // there must be an integer in the interval
    return l + getRandIntLessThan(h - l + 1);
  }
};
