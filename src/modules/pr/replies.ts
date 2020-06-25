import * as PR from './pr'
import { EMOJIS, GITHUB_APP_URL } from '../../consts'
import * as Actions from './actions'
import * as User from '../users'
import * as Slack from '../slack/api'

export async function updateHeaderMessage(pr: PullRequestDocument) {
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

  return PR.reply(pr, {
    replyId: 'header_message',
    text: textParts,
    payload: { title, size, actions },
  })
}

export async function updateErrorMessage(pr: PullRequestDocument) {
  const { error } = pr

  if (error?.status === 404 || error?.status === 403) {
    await PR.reply(pr, {
      replyId: 'error',
      text: `Sorry, but I think my <${GITHUB_APP_URL}|Github App> is not installed on this repository :thinking_face:. Please post this pull request again after installing the app (•ᴥ•)`,
    })
  }

  if (error?.status === 520) {
    await PR.reply(pr, {
      replyId: 'error',
      text: `Sorry, but something awful happened :scream:. I can't see this PR status...`,
    })
  }
}

export async function updateDirtyMessage(pr: PullRequestDocument) {
  if (PR.isDirty(pr)) {
    await PR.reply(pr, {
      replyId: 'is_dirty',
      text: `The branch \`${pr.head_branch}\` is dirty. It may need a rebase with \`${pr.base_branch}\`.`,
    })
  } else {
    await PR.deleteReply(pr, { replyId: 'is_dirty' })
  }
}

export async function updateChangelogMessage(pr: PullRequestDocument) {
  if (!PR.isTrivial(pr) && !PR.hasChangelog(pr)) {
    await PR.reply(pr, {
      replyId: 'modified_changelog',
      text: `I couln't find an addition to the \`CHANGELOG.md\`.\n\nDid you forget to add it :notsure:?`,
    })
  } else {
    await PR.deleteReply(pr, { replyId: 'modified_changelog' })
  }
}

export async function updateMergeabilityMessage(pr: PullRequestDocument) {
  if (PR.isMergeable(pr) === false || Actions.hasChangesRequested(pr)) {
    await PR.deleteReply(pr, { replyId: 'ready_to_merge' })
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

    await PR.reply(pr, { replyId: 'ready_to_merge', text })
  }
}

export async function reevaluateReplies(pr: PullRequestDocument) {
  if (pr.error) {
    return updateErrorMessage(pr)
  }

  await PR.deleteReply(pr, { replyId: 'error' })

  await updateHeaderMessage(pr)
  await updateDirtyMessage(pr)
  await updateChangelogMessage(pr)
  await updateMergeabilityMessage(pr)
}
