import { EMOJIS, BLOCK_MAX_LEN } from '../../../consts'
import * as Messages from '../messages'
import * as PR from '../../pr/pr'
import * as Slack from '../api'
import { getThreadReplyURL } from '../../pr/replies'
import { hasChangesRequested } from '../../pr/actions'

function pluralize(str, n) {
  return `${n} ${str}${n > 1 ? 's' : ''}`
}

function formatTime(n) {
  if (n <= 72) return `${n} hours old`

  n = Math.floor(n / 24)

  if (n <= 30) {
    return `${pluralize('day', n)} old`
  }

  n = Math.floor(n / 30)

  return `${pluralize('month', n)} old`
}

type Entries = Array<[ChannelMessageDocument, PullRequestDocument]>

export async function formatPullRequestListSections(prEntries: Entries) {
  const linkMap = Object.fromEntries(
    await Promise.all(
      prEntries.map(async ([rootMsg, pr]) => {
        const msgURL = await getThreadReplyURL({
          channel: rootMsg.channel,
          rootTs: rootMsg.ts,
          ts: rootMsg.replies?.['header_message']?.ts,
        })

        const text = `${pr.repo}/${pr.number}`

        return [PR.getPullRequestID(pr), Slack.formatLink(msgURL, text)]
      })
    )
  )

  const sections = {
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
  } as Record<string, { title: string; list: Entries }>

  for (const [msg, pr] of prEntries) {
    let section

    if (PR.isMergeable(pr)) {
      section = sections.ready_to_merge
    } else if (PR.isDirty(pr)) {
      section = sections.dirty
    } else if (hasChangesRequested(pr)) {
      section = sections.changes_requested
    } else {
      section = sections.waiting_review
    }

    section.list.push([msg, pr])
  }

  const blocks = Object.values(sections)
    .filter((section) => section.list.length)
    .map((section) => ({
      ...section,
      list: section.list.sort(
        ([msgA], [msgB]) =>
          Messages.getTimeSincePost(msgB) - Messages.getTimeSincePost(msgA)
      ),
    }))
    .flatMap(({ title, list }) => {
      const text = `*${title}  (${list.length})*:\n${list
        .map(([msg, pr]) => {
          return (
            `:${EMOJIS[`size_${pr.size.label}`]}:  ` +
            `${linkMap[PR.getPullRequestID(pr)]} ` +
            `_(${formatTime(Messages.getTimeSincePost(msg))})_`
          )
        })
        .join('\n')}`

      if (text.length < BLOCK_MAX_LEN) {
        return Messages.blocks.createMarkdownSection(text)
      }

      // if block text is greater than 3000 limit, split it into multiple blocks.
      const chunks: string[] = []
      let slicedText = text

      do {
        let chunk = slicedText.slice(0, BLOCK_MAX_LEN)

        if (chunk.length === BLOCK_MAX_LEN) {
          // slice before the last line break
          const cutIndex = chunk.lastIndexOf('\n')

          if (cutIndex > -1) {
            chunk = chunk.slice(0, cutIndex)
          }
        }

        chunks.push(chunk)
        slicedText = slicedText.slice(chunk.length)
      } while (slicedText.length > 0)

      return chunks.map(Messages.blocks.createMarkdownSection)
    })

  return blocks
}
