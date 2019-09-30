const R = require('ramda');

const Message = require('../message.js');
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
      } else if (pr.is_dirty()) {
        section = acc.dirty;
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
      dirty: {
        title: `:${EMOJIS.dirty}: Needs rebase`,
        list: [],
      },
      waiting_review: {
        title: `:${EMOJIS.waiting}: Waiting review`,
        list: [],
      },
    },
  );

  return Object.values(sections)
    .filter(section => section.list.length)
    .map(section => ({
      ...section,
      list: section.list.sort(
        (pr_a, pr_b) => pr_b.hours_since_post - pr_a.hours_since_post,
      ),
    }))
    .map(({ title, list }) =>
      Message.blocks.create_markdown_section(
        `*${title}  (${list.length})*:\n${list
          .map(pr => {
            const {
              hours_since_post,
              state: { size },
            } = pr;

            return (
              `:${EMOJIS[`size_${size.label}`]}:  ` +
              `${link_map[pr.slug]} ` +
              `_(${hours_since_post} hours ago)_`
            );
          })
          .join('\n')}`,
      ),
    );
};
