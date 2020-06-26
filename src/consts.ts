export const GITHUB_APP_URL = 'https://github.com/apps/paul-robotson-pr-bot'
export const GITHUB_FIELD_ID = 'XfCCUXUDPH'

export const BOT_NAME = 'Paul Robotson'

export const PR_MESSAGE_REGEX = /github\.com\/([\w-.]*)?\/([\w-.]*?)\/pull\/(\d+)/i

export const EMOJIS = {
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
}

export const PR_SIZES: Array<[string, number]> = [
  ['small', 80],
  ['medium', 250],
  ['large', 800],
  ['gigantic', Infinity],
]

export const FORGOTTEN_PR_HOUR_THRESHOLD = 24
export const BLOCK_MAX_LEN = 3000

// dev
export const PRIVATE_TEST_CHANNELS = ['GKSCG1GRX', 'GLAM8UANR']
