exports.EMOJIS = {
  watching: 'robot_face',
  approved: 'white_check_mark',
  ready_to_merge: 'white_check_mark',
  commented: 'speech_balloon',
  merged: 'merged',
  changes_requested: 'changes',
  needs_attention: 'alert',
  closed: 'closedpr',
  unstable_or_dirty: 'warning',
  unknown: 'shrug',
  review_requested: 'clock3',
  waiting: 'sonic_waiting',
  quick_read: 'zap',
  pending_review: 'eyes',
  // size_small: 'ant',
  // size_medium: 'dog2',
  // size_big: 'elephant',
  // size_gigantic: 'sauropod',
  size_small: 'pr-small',
  size_medium: 'pr-medium',
  size_big: 'pr-large',
  size_gigantic: 'pr-xlarge',
};

exports.GITHUB_FIELD_ID = 'XfCCUXUDPH';
exports.FORGOTTEN_PR_HOUR_THRESHOLD = 24;
exports.PR_SIZES = [
  ['small', 80],
  ['medium', 250],
  ['big', 800],
  ['gigantic', Infinity],
];

// github api 5000 calls/hour / 2 calls per pr / checks per minute
const GITHUB_MAX_REQUESTS = 5000;
const REQUESTS_PER_PR = 2;
exports.MAX_PRS = ~~(GITHUB_MAX_REQUESTS / REQUESTS_PER_PR / 60);

// dev
exports.PRIVATE_TEST_CHANNELS = ['GKSCG1GRX', 'GLAM8UANR'];
