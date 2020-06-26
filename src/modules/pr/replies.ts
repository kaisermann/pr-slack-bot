import memoize from 'memoizee'
import isDeepEqual from 'fast-deep-equal'

import * as PR from './pr'
import { EMOJIS, GITHUB_APP_URL } from '../../consts'
import * as Actions from './actions'
import * as User from '../users'
import * as Messages from '../slack/messages'
import * as Slack from '../slack/api'

function mapSlackReplyToReplyEntry(reply: SlackReply) {
  return {
    ts: reply.ts,
    blocks: reply.blocks,
    text: reply.text,
    payload: reply.payload,
  }
}

export async function deleteReply(
  rootMsg: ChannelMessageDocument,
  { replyId }: { replyId: string }
) {
  if (!(replyId in rootMsg.replies)) {
    return false
  }

  const replyData = rootMsg.replies[replyId]

  return Messages.deleteMessage({
    channel: rootMsg.channel,
    ts: replyData.ts,
  })
    .then(() => {
      delete rootMsg.replies[replyId]
    })
    .catch((e) => {
      console.log(e.data)
      console.log(e.data.error)
      if (e.data && e.data.error === 'message_not_found') {
        console.error(`- Tried to delete an already deleted message`)

        delete rootMsg.replies[replyId]
      }

      throw e
    })
}

// async function deleteReplies(
//   pr: PullRequestIdentifier,
//   replyIds: string[] = []
// ) {
//   if (replyIds.length === 0) {
//     const repliesSnapshot = await PR.getPullRequestRef(pr)
//       .collection('replies')
//       .get()

//     replyIds = repliesSnapshot.docs.map((doc) => doc.id)
//   }

//   return Promise.all(replyIds.map((replyId) => deleteReply(pr, { replyId })))
// }

async function updateThreadReply(
  rootMsg: ChannelMessageDocument,
  {
    replyId,
    text,
    payload,
  }: {
    replyId: string
    text: TextBuilderArg
    payload: unknown
  }
) {
  const replyData = rootMsg.replies[replyId]

  if (replyData == null) {
    return false
  }

  if (
    replyData.payload != null &&
    payload != null &&
    isDeepEqual(replyData.payload, payload)
  ) {
    return false
  }

  const newText = Messages.buildText(text)

  if (replyData.text === newText) {
    return false
  }

  if (newText === '') {
    return deleteReply(rootMsg, { replyId })
  }

  console.info(`- Updating reply: ${text}`)

  const updatedMessage = await Messages.updateMessage(
    {
      thread_ts: rootMsg.ts,
      channel: rootMsg.channel,
      ...replyData,
    },
    (message) => {
      message.text = newText
      message.payload = payload
    }
  )

  rootMsg.replies[replyId] = mapSlackReplyToReplyEntry(updatedMessage)

  return true
}

export async function replyToThread(
  rootMsg: ChannelMessageDocument,
  {
    replyId,
    text,
    payload,
  }: {
    replyId: string
    text: TextBuilderArg
    payload?: unknown
  }
) {
  const { channel, ts, replies } = rootMsg
  const builtText = Messages.buildText(text)

  if (replyId in replies) {
    return updateThreadReply(rootMsg, { replyId, text, payload })
  }

  if (builtText === '') return false

  console.info(`- Sending reply: ${builtText}`)

  return Messages.sendMessage({
    text: builtText,
    channel,
    thread_ts: ts,
    payload,
  })
    .then((msg) => {
      rootMsg.replies[replyId] = mapSlackReplyToReplyEntry(msg)
    })
    .then(() => true)
}

export async function updateHeaderMessage(
  rootMsg: ChannelMessageDocument,
  pr: PullRequestDocument
) {
  const { size, title, actions } = pr

  const reducedActions = Actions.reduceActions(actions)
  const textParts = [
    `:${EMOJIS.info}: *Title*: ${title}\n\n`,
    `:${EMOJIS[`size_${size.label}`]}: *PR size*: ${size.label} (_${
      size.changes
    } changes_)\n\n`,
  ]

  if (reducedActions.length === 0) {
    textParts.push(`:${EMOJIS.waiting}: Waiting for reviewers`)
  } else {
    const groupedActions = Actions.groupByAction(reducedActions)
    const headerText = (
      await Promise.all(
        groupedActions.map(async ([action, ghUsers]) => {
          const { label, emoji } = Actions.getActionLabel(action)

          const slackUsers = await Promise.all(
            ghUsers.map((ghUser) =>
              User.githubUserToSlackID(ghUser).catch(() => ghUser)
            )
          )

          const slackMentions = slackUsers.map(Slack.formatUserMention)

          return `:${emoji}: *${label}*: ${slackMentions.join(', ')}`
        })
      )
    ).join('\n\n')

    textParts.push(headerText)
  }

  return replyToThread(rootMsg, {
    replyId: 'header_message',
    text: textParts,
    payload: { title, size, actions },
  })
}

export async function updateErrorMessage(
  rootMsg: ChannelMessageDocument,
  pr: PullRequestDocument
) {
  const { error } = pr

  if (error?.status === 404 || error?.status === 403) {
    await replyToThread(rootMsg, {
      replyId: 'error',
      text: `Sorry, but I think my <${GITHUB_APP_URL}|Github App> is not installed on this repository :thinking_face:. Please post this pull request again after installing the app (•ᴥ•)`,
    })
  }

  if (error?.status === 520) {
    await replyToThread(rootMsg, {
      replyId: 'error',
      text: `Sorry, but something awful happened :scream:. I can't see this PR status...`,
    })
  }
}

export async function updateDirtyMessage(
  rootMsg: ChannelMessageDocument,
  pr: PullRequestDocument
) {
  if (PR.isDirty(pr)) {
    await replyToThread(rootMsg, {
      replyId: 'is_dirty',
      text: `The branch \`${pr.head_branch}\` is dirty. It may need a rebase with \`${pr.base_branch}\`.`,
    })
  } else {
    await deleteReply(rootMsg, { replyId: 'is_dirty' })
  }
}

export async function updateChangelogMessage(
  rootMsg: ChannelMessageDocument,
  pr: PullRequestDocument
) {
  if (!PR.isTrivial(pr) && !PR.hasChangelog(pr)) {
    await replyToThread(rootMsg, {
      replyId: 'modified_changelog',
      text: `I couln't find an addition to the \`CHANGELOG.md\`.\n\nDid you forget to add it :notsure:?`,
    })
  } else {
    await deleteReply(rootMsg, { replyId: 'modified_changelog' })
  }
}

export async function updateMergeabilityMessage(
  rootMsg: ChannelMessageDocument,
  pr: PullRequestDocument
) {
  if (PR.isMergeable(pr) === false || Actions.hasChangesRequested(pr)) {
    await deleteReply(rootMsg, { replyId: 'ready_to_merge' })
  } else {
    let text = ''
    const { canMerge, defcon } = await PR.canBeMerged(pr)

    if (!canMerge && defcon) {
      text += `This PR would be ready to be merged, but we're at *DEFCON ${defcon.id}* :harold-pain:. ${defcon.message}.`
    } else {
      const nApprovals = Actions.getApprovalCount(pr)
      const isReleaseBranch = !!pr.base_branch.match(
        /^(?:master|release[/-]?|(?:\d\.)+x)/i
      )

      if (nApprovals === 0 && isReleaseBranch) {
        text += `PR is ready to be merged, but I can't seem to find any reviews approving it :notsure-left:.\n\nIs there a merge protection rule configured for the \`${pr.base_branch}\` branch?`
      } else {
        text += 'PR is ready to be merged :doit:!'
      }

      if (defcon?.level === 'info') {
        text += `\n\nRemember that we're at *DEFCON ${defcon.id}* :apruved:. ${defcon.message}.`
      }
    }

    await replyToThread(rootMsg, { replyId: 'ready_to_merge', text })
  }
}

export async function updateMessageReplies(
  rootMsg: ChannelMessageDocument,
  pr: PullRequestDocument
) {
  if (pr.error) {
    return updateErrorMessage(rootMsg, pr)
  }

  await deleteReply(rootMsg, { replyId: 'error' })

  await updateHeaderMessage(rootMsg, pr)
  await updateDirtyMessage(rootMsg, pr)
  await updateChangelogMessage(rootMsg, pr)
  await updateMergeabilityMessage(rootMsg, pr)
}

export const getThreadReplyURL = memoize(
  async ({
    channel,
    rootTs,
    ts,
  }: {
    channel: string
    rootTs: string
    ts: string | undefined
  }) => {
    let msgURL = await Slack.getMessageURL({ channel, ts: rootTs })

    if (ts) {
      msgURL = msgURL.replace(
        /\/p\d*?$/,
        `/p${parseFloat(ts) * 1000000}?thread_ts=${rootTs}`
      )
    }

    return msgURL
  }
)
