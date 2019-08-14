const R = require('ramda');

const { EMOJIS } = require('../consts.js');

module.exports = async prs => {
  const link_map = R.fromPairs(
    await Promise.all(
      prs.map(async pr => [
        pr.slug,
        await pr.get_message_link(pr => `${pr.repo}/${pr.pr_id}`),
      ]),
    ),
  );

  const sections = prs.reduce(
    (acc, pr) => {
      let section;
      if (pr.is_ready_to_merge()) {
        section = acc.ready_to_merge;
      } else if (pr.is_dirty() || pr.is_unstable()) {
        section = acc.unstable_or_dirty;
      } else if (pr.has_changes_requested()) {
        section = acc.changes_requested;
      } else {
        section = acc.waiting_review;
      }

      section.list.push(pr);

      return acc;
    },
    {
      ready_to_merge: {
        title: `:${EMOJIS.ready_to_merge}: Ready to be merged`,
        list: [],
      },
      changes_requested: {
        title: `:${EMOJIS.changes_requested}: Changes requested`,
        list: [],
      },
      unstable_or_dirty: {
        title: `:${EMOJIS.unstable_or_dirty}: Unstable or needs rebase`,
        list: [],
      },
      waiting_review: {
        title: `:${EMOJIS.waiting}: Waiting review`,
        list: [],
      },
    },
  );

  return R.pipe(
    R.values,
    R.filter(section => section.list.length),
    R.map(
      ({ title, list }) =>
        `*${title}*:\n${list
          .map(
            pr => `${link_map[pr.slug]} _(${pr.hours_since_post} hours ago)_`,
          )
          .join('\n')}`,
    ),
    R.join('\n\n'),
  )(sections);
};
