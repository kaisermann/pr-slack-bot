exports.GITHUB_APP_URL = 'https://github.com/apps/paul-robotson-pr-bot';
exports.GITHUB_FIELD_ID = 'XfCCUXUDPH';

exports.BOT_NAME = 'Paul Robotson';

exports.EMOJIS = {
  approved: 'github-check-done',
  ready_to_merge: 'ready-to-merge',
  commented: 'speech_balloon',
  merged: 'merged',
  changes_requested: 'changes',
  closed: 'closedpr',
  dirty: 'warning',
  unknown: 'shrug',
  waiting: 'sonic_waiting',
  pending_review: 'eyes',
  size_small: 'pr-small',
  size_medium: 'pr-medium',
  size_large: 'pr-large',
  size_gigantic: 'pr-xlarge',
  info: 'info',
};

exports.PR_SIZES = [
  ['small', 80],
  ['medium', 250],
  ['large', 800],
  ['gigantic', Infinity],
];

exports.FORGOTTEN_PR_HOUR_THRESHOLD = 24;
exports.BLOCK_MAX_LEN = 3000;

// dev
exports.PRIVATE_TEST_CHANNELS = ['GKSCG1GRX', 'GLAM8UANR'];
