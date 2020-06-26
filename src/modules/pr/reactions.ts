import * as Slack from '../slack/api'
import { EMOJIS } from '../../consts'
import * as Actions from './actions'
import * as PR from './pr'

async function removeReaction(
  msg: ChannelMessageDocument,
  {
    type,
  }: {
    type: string
  }
) {
  const { channel, ts, reactions } = msg

  if (!(type in reactions)) {
    return
  }

  const emoji = reactions[type]

  console.info(`- Removing reaction of type: ${type} (${reactions[type]})`)

  return Slack.botClient.reactions
    .remove({ name: emoji, timestamp: ts, channel })
    .then(() => {
      delete reactions[type]
    })
    .catch((e) => {
      if (e.data && e.data.error === 'already_reacted') {
        delete reactions[type]
      }

      throw e
    })
}

async function addReaction(msg: ChannelMessageDocument, { type, emoji }) {
  const { channel, ts, reactions } = msg

  if (type in reactions) {
    if (reactions[type] === emoji) return false
    await removeReaction(msg, {
      type,
    })
  }

  console.info(`- Adding reaction of type: ${type} (${emoji})`)

  return Slack.botClient.reactions
    .add({ name: emoji, timestamp: ts, channel })
    .then(() => {
      reactions[type] = emoji
    })
    .catch((e) => {
      if (e.data && e.data.error === 'already_reacted') {
        reactions[type] = emoji
      }

      throw e
    })
}

export async function updateMessageReactions(
  rootMsg: ChannelMessageDocument,
  pr: PullRequestDocument
) {
  const { size, merged, closed } = pr

  const changesRequested = Actions.hasChangesRequested(pr)

  await addReaction(rootMsg, {
    type: 'size',
    emoji: EMOJIS[`size_${size.label}`],
  })

  if (changesRequested) {
    await addReaction(rootMsg, {
      type: 'changes_requested',
      emoji: EMOJIS.changes_requested,
    })
  } else {
    await removeReaction(rootMsg, {
      type: 'changes_requested',
    })
  }

  if (PR.isMergeable(pr) && changesRequested === false) {
    const nApprovals = Actions.getApprovalCount(pr)

    await addReaction(rootMsg, {
      type: 'approved',
      emoji: nApprovals > 0 ? EMOJIS.approved : EMOJIS.ready_to_merge,
    })
  } else {
    await removeReaction(rootMsg, {
      type: 'approved',
    })
  }

  if (Actions.hasComment(pr)) {
    await addReaction(rootMsg, {
      type: 'has_comment',
      emoji: EMOJIS.commented,
    })
  } else {
    await removeReaction(rootMsg, {
      type: 'has_comment',
    })
  }

  if (Actions.isWaitingReview(pr)) {
    await addReaction(rootMsg, {
      type: 'is_waiting_review',
      emoji: EMOJIS.waiting,
    })
  } else {
    await removeReaction(rootMsg, {
      type: 'is_waiting_review',
    })
  }

  if (Actions.hasPendingReview(pr)) {
    await addReaction(rootMsg, {
      type: 'pending_review',
      emoji: EMOJIS.pending_review,
    })
  } else {
    await removeReaction(rootMsg, {
      type: 'pending_review',
    })
  }

  if (PR.isDirty(pr)) {
    await addReaction(rootMsg, {
      type: 'dirty',
      emoji: EMOJIS.dirty,
    })
  } else {
    await removeReaction(rootMsg, {
      type: 'dirty',
    })
  }

  if (merged) {
    await addReaction(rootMsg, {
      type: 'merged',
      emoji: EMOJIS.merged,
    })
  } else {
    await removeReaction(rootMsg, {
      type: 'merged',
    })
  }

  if (closed && !merged) {
    await addReaction(rootMsg, {
      type: 'closed',
      emoji: EMOJIS.closed,
    })
  } else {
    await removeReaction(rootMsg, {
      type: 'closed',
    })
  }
}
