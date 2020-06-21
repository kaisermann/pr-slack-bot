import * as Slack from '../slack'
import { getPullRequestData, getPullRequestRef } from './pr'
import { EMOJIS } from '../../consts'

export async function removeReaction({ pr, type }) {
  const prRef = getPullRequestRef(pr)
  const {
    thread: { channel, ts, reactions },
  } = await getPullRequestData(prRef)

  if (!(type in reactions)) {
    return false
  }
  const emoji = reactions[type]

  console.info(`- Removing reaction of type: ${type} (${reactions[type]})`)

  return Slack.botClient.reactions
    .remove({ name: emoji, timestamp: ts, channel })
    .then(() => {
      prRef.update({
        reactions: { ...reactions, [type]: emoji },
      })

      return true
    })
    .catch(e => {
      if (e.data && e.data.error === 'already_reacted') {
        prRef.update({
          reactions: { ...reactions, [type]: emoji },
        })

        return false
      }
      throw e
    })
}

export async function addReaction({ pr, type, name: emoji }) {
  const prRef = getPullRequestRef(pr)
  const {
    thread: { channel, ts, reactions },
  } = await getPullRequestData(prRef)

  if (type in reactions) {
    if (reactions[type] === emoji) return false
    await removeReaction(type)
  }

  console.info(`- Adding reaction of type: ${type} (${emoji})`)

  return Slack.botClient.reactions
    .add({ name: emoji, timestamp: ts, channel })
    .then(() => {
      prRef.update({
        reactions: { ...reactions, [type]: emoji },
      })

      return true
    })
    .catch(e => {
      if (e.data && e.data.error === 'already_reacted') {
        prRef.update({
          reactions: { ...reactions, [type]: emoji },
        })

        return false
      }
      throw e
    })
}

export async function reevaluateReactions({ owner, repo, number }) {
  const { size, merged, closed } = await getPullRequestData({
    owner,
    repo,
    number,
  })

  const changesRequested = has_changes_requested()

  await addReaction('size', EMOJIS[`size_${size.label}`] as any)

  if (changesRequested) {
    await addReaction('changes_requested', EMOJIS.changes_requested)
  } else {
    await removeReaction('changes_requested')
  }

  if (is_mergeable() && changesRequested === false) {
    const n_approvals = get_approvals()

    await addReaction(
      'approved',
      n_approvals > 0 ? EMOJIS.approved : EMOJIS.ready_to_merge
    )
  } else {
    await removeReaction('approved')
  }

  if (has_comment()) {
    await addReaction('has_comment', EMOJIS.commented)
  } else {
    await removeReaction('has_comment')
  }

  if (is_waiting_review()) {
    await addReaction('is_waiting_review', EMOJIS.waiting)
  } else {
    await removeReaction('is_waiting_review')
  }

  if (has_pending_review()) {
    await addReaction('pending_review', EMOJIS.pending_review)
  } else {
    await removeReaction('pending_review')
  }

  if (is_dirty()) {
    await addReaction('dirty', EMOJIS.dirty)
  } else {
    await removeReaction('dirty')
  }

  if (merged) {
    await addReaction('merged', EMOJIS.merged)
  } else {
    await removeReaction('merged')
  }

  if (closed && !merged) {
    await addReaction('closed', EMOJIS.closed)
  } else {
    await removeReaction('closed')
  }
}
