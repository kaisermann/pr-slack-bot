const { EMOJIS, PR_SIZES } = require('../../consts.js');

module.exports = async () => {
  function format_section(items, title) {
    return `*${title}*:\n${items
      .map(([emoji, str]) => `:${emoji}: - ${str}`)
      .join(';\n')}.`;
  }

  const sizes = PR_SIZES.map(([label, max], i) => [
    EMOJIS[`size_${label}`],
    `PR of small size _(${
      max === Infinity ? `>${PR_SIZES[i - 1][1] + 1}` : `<=${max}`
    } changes)_`,
  ]);

  const reviews = [
    [EMOJIS.pending_review, 'Someone is reviewing'],
    [EMOJIS.waiting, 'Awaiting reviews'],
    [EMOJIS.commented, 'Someone has commented'],
    [EMOJIS.changes_requested, 'Some changes were requested'],
  ];

  const pr_states = [
    [
      EMOJIS.dirty,
      'The head branch is dirty and may need a rebase with the base branch',
    ],
    [EMOJIS.ready_to_merge, 'Ready to be merged without approvals'],
    [EMOJIS.approved, ' Ready to be merged AND approved'],
    [EMOJIS.merged, 'PR was merged'],
    [EMOJIS.closed, 'PR was closed'],
  ];

  const other = [
    [
      EMOJIS.unknown,
      'Some unknown action was taken. Please report it :robot_face:',
    ],
  ];

  return [
    `*Here's the meaning of each emoji*:`,
    format_section(sizes, 'Sizes'),
    format_section(reviews, 'Review related'),
    format_section(pr_states, 'Pull request states'),
    format_section(other, 'Miscellaneous'),
  ].join('\n\n');
};
