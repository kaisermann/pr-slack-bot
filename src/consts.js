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

exports.PR_CHECK_PER_MINUTE = 1;
exports.PR_CHECK_LOOP_INTERVAL = (60 / exports.PR_CHECK_PER_MINUTE) * 1000;
// github api 5000 calls/hour / 2 calls per pr / checks per minute
exports.MAX_PRS = ~~(5000 / 60 / 2 / exports.PR_CHECK_PER_MINUTE);
