import * as Slack from '../slack/api'
import {
  getPullRequestDocument,
  getPullRequestRef,
  isDirty,
  isMergeable,
} from './pr'
import { EMOJIS } from '../../consts'
import {
  getApprovalCount,
  hasChangesRequested,
  hasComment,
  isWaitingReview,
  hasPendingReview,
} from './actions'

export async function removeReaction(pr, { type }) {
  const prRef = getPullRequestRef(pr)
  const {
    thread: { channel, ts, reactions },
  } = await getPullRequestDocument(prRef)

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
    .catch((e) => {
      if (e.data && e.data.error === 'already_reacted') {
        prRef.update({
          reactions: { ...reactions, [type]: emoji },
        })

        return false
      }

      throw e
    })
}

export async function addReaction(pr, { type, emoji }) {
  const prRef = getPullRequestRef(pr)
  const {
    thread: { channel, ts, reactions },
  } = await getPullRequestDocument(prRef)

  if (type in reactions) {
    if (reactions[type] === emoji) return false
    await removeReaction(pr, type)
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
    .catch((e) => {
      if (e.data && e.data.error === 'already_reacted') {
        prRef.update({
          reactions: { ...reactions, [type]: emoji },
        })

        return false
      }

      throw e
    })
}

export async function reevaluateReactions(pr: PullRequestDocument) {
  const { size, merged, closed } = pr

  const changesRequested = hasChangesRequested(pr)

  await addReaction(pr, {
    type: 'size',
    emoji: EMOJIS[`size_${size.label}`],
  })

  if (changesRequested) {
    await addReaction(pr, {
      type: 'changes_requested',
      emoji: EMOJIS.changes_requested,
    })
  } else {
    await removeReaction(pr, { type: 'changes_requested' })
  }

  if (isMergeable(pr) && changesRequested === false) {
    const nApprovals = getApprovalCount(pr)

    await addReaction(pr, {
      type: 'approved',
      emoji: nApprovals > 0 ? EMOJIS.approved : EMOJIS.ready_to_merge,
    })
  } else {
    await removeReaction(pr, { type: 'approved' })
  }

  if (hasComment(pr)) {
    await addReaction(pr, { type: 'has_comment', emoji: EMOJIS.commented })
  } else {
    await removeReaction(pr, { type: 'has_comment' })
  }

  if (isWaitingReview(pr)) {
    await addReaction(pr, { type: 'is_waiting_review', emoji: EMOJIS.waiting })
  } else {
    await removeReaction(pr, { type: 'is_waiting_review' })
  }

  if (hasPendingReview(pr)) {
    await addReaction(pr, {
      type: 'pending_review',
      emoji: EMOJIS.pending_review,
    })
  } else {
    await removeReaction(pr, { type: 'pending_review' })
  }

  if (isDirty(pr)) {
    await addReaction(pr, { type: 'dirty', emoji: EMOJIS.dirty })
  } else {
    await removeReaction(pr, { type: 'dirty' })
  }

  if (merged) {
    await addReaction(pr, { type: 'merged', emoji: EMOJIS.merged })
  } else {
    await removeReaction(pr, { type: 'merged' })
  }

  if (closed && !merged) {
    await addReaction(pr, { type: 'closed', emoji: EMOJIS.closed })
  } else {
    await removeReaction(pr, { type: 'closed' })
  }
}
