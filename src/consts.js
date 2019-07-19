exports.EMOJIS = {
  watching: 'robot_face',
  approved: 'white_check_mark',
  commented: 'speech_balloon',
  merged: 'merged',
  changes_requested: 'changes',
  needs_attention: 'alert',
  closed: 'closedpr',
  unstable: 'warning',
  unknown: 'shrug',
  review_requested: 'clock3',
  waiting: 'sonic_waiting',
  quick_read: 'zap',
  size_small: 'zap',
  size_medium: 'surprised-pikachu',
  size_big: 'donotwant',
  size_gigantic: 'developers',
};

exports.GITHUB_FIELD_ID = 'XfCCUXUDPH';
exports.FORGOTTEN_PR_HOUR_THRESHOLD = 24;
exports.NEEDED_REVIEWS = 2;
exports.PR_SIZES = [
  ['small', 80],
  ['medium', 250],
  ['big', 800],
  ['gigantic', Infinity],
];

exports.PRIVATE_TEST_CHANNELS = ['GKSCG1GRX', 'GLAM8UANR'];

exports.PR_CHECK_PER_MINUTE = 1;
exports.PR_CHECK_LOOP_INTERVAL = (60 / exports.PR_CHECK_PER_MINUTE) * 1000;
// github api 5000 calls/hour / 2 calls per pr / checks per minute
exports.MAX_PRS = ~~(5000 / 60 / 2 / exports.PR_CHECK_PER_MINUTE);
