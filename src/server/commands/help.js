const { EMOJIS, PR_SIZES } = require('../../consts.js');

const commands = [
  ['`/pr help`', 'list all emoji meanings and commands'],
  ['`/pr list`', 'list all open prs on the channel'],
  ['`/pr list mine`', 'list all of your PRs on the channel'],
  ['`/pr list @user`', 'list all PRs on the channel from a specific user'],
  [
    '`/pr list @userGroup`',
    'list all PRs on the channel from a specific user group',
  ],
  [
    '`@Paul Robotson roulette|random`',
    'on a PR Thread, mention a random person from the channel',
  ],
  [
    '`@Paul Robotson roulette|random group-name`',
    'on a PR Thread, mention a random person from a specific slack group',
  ],
];

const utils = [
  [
    'add a `#trivial` to your PR title or body to prevent checking for a CHANGELOG update',
  ],
];

const emojis = [
  ...PR_SIZES.map(([label, max], i) => [
    EMOJIS[`size_${label}`],
    `PR of small size _(${
      max !== Infinity ? `<=${max}` : `>${PR_SIZES[i - 1][1] + 1}`
    } changes)_`,
  ]),
  [EMOJIS.pending_review, 'Someone is reviewing'],
  [EMOJIS.waiting, 'Awaiting reviews'],
  [EMOJIS.commented, 'Someone has commented'],
  [EMOJIS.changes_requested, 'Some changes were requested'],

  [
    EMOJIS.dirty,
    'The head branch is dirty and may need a rebase with the base branch',
  ],
  [EMOJIS.ready_to_merge, 'Ready to be merged without approvals'],
  [EMOJIS.approved, ' Ready to be merged AND approved'],
  [EMOJIS.merged, 'PR was merged'],
  [EMOJIS.closed, 'PR was closed'],
  [
    EMOJIS.unknown,
    'Some unknown action was taken. Please report it :robot_face:',
  ],
].map(([emoji, label]) => [`:${emoji}:`, label]);

function format_help_section(items, title) {
  return `*${title}*:\n${items
    .map(([cmd, str]) => (str ? `${cmd} - ${str}` : `- ${cmd}`))
    .join(';\n')}.`;
}

module.exports = () =>
  [
    format_help_section(commands, 'Available commands'),
    format_help_section(utils, 'Utilities'),
    format_help_section(emojis, 'Emojis'),
  ].join('\n\n\n');
