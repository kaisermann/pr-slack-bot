exports.EMOJIS = {
  watching: 'robot_face',
  approved: 'white_check_mark',
  commented: 'speech_balloon',
  merged: 'merged',
  changes_requested: 'changes',
  quick_read: 'zap',
  needs_attention: 'alert',
  closed: 'closedpr',
  unstable: 'warning',
  unknown: 'shrug',
  review_requested: 'clock3',
};

exports.GITHUB_FIELD_ID = 'XfCCUXUDPH';
exports.FORGOTTEN_PR_HOUR_THRESHOLD = 24;
exports.QUICK_ADDITION_LIMIT = 80;
exports.NEEDED_REVIEWS = 2;

exports.PRIVATE_TEST_CHANNELS = ['GKSCG1GRX', 'GLAM8UANR'];

exports.PR_CHECK_INTERVAL_SECONDS = 20;
// github api 5000 calls/min limit * 2 calls (pull+reviews) / how many checks per minute
exports.MAX_PRS = ~~(5000 / (2 * (60 / exports.PR_CHECK_INTERVAL_SECONDS)));
