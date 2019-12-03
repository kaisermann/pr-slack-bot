const Message = require('../includes/message.js');
const { EMOJIS, BLOCK_MAX_LEN } = require('../consts.js');

function pluralize(str, n) {
  return `${n} ${str}${n > 1 ? 's' : ''}`;
}

function format_time(n) {
  if (n <= 72) return `${n} hours old`;

  n = Math.floor(n / 24);
  if (n <= 30) return `${pluralize('day', n)} old`;

  n = Math.floor(n / 30);
  return `${pluralize('month', n)} old`;
}

module.exports = async prs => {
  const link_map = Object.fromEntries(
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
      if (pr.is_mergeable()) {
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

  const blocks = Object.values(sections)
    .filter(section => section.list.length)
    .map(section => ({
      ...section,
      list: section.list.sort(
        (pr_a, pr_b) => pr_b.hours_since_post - pr_a.hours_since_post,
      ),
    }))
    .flatMap(({ title, list }) => {
      const text = `*${title}  (${list.length})*:\n${list
        .map(pr => {
          const {
            hours_since_post,
            state: { size },
          } = pr;

          return (
            `:${EMOJIS[`size_${size.label}`]}:  ` +
            `${link_map[pr.slug]} ` +
            `_(${format_time(hours_since_post)})_`
          );
        })
        .join('\n')}`;

      if (text.length < BLOCK_MAX_LEN) {
        return Message.blocks.create_markdown_section(text);
      }

      // if block text is greater than 3000 limit, split it into multiple blocks.
      const chunks = [];
      let sliced_text = text;
      do {
        let chunk = sliced_text.slice(0, BLOCK_MAX_LEN);
        if (chunk.length === BLOCK_MAX_LEN) {
          // slice before the last line break
          let cut_index = chunk.lastIndexOf('\n');

          if (cut_index > -1) {
            chunk = chunk.slice(0, cut_index);
          }
        }
        chunks.push(chunk);
        sliced_text = sliced_text.slice(chunk.length);
      } while (sliced_text.length > 0);
      return chunks.map(Message.blocks.create_markdown_section);
    });

  return blocks;
};
