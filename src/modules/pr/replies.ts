import * as PR from './pr'
import { EMOJIS } from '../../consts'
import { groupByAction, getActionLabel, reduceActions } from './actions'
import * as User from '../users'
import * as Slack from '../slack'

export async function reevaluateReplies({ owner, repo, number }) {
  await Promise.all([updateHeaderMessage({ owner, repo, number })])
}

export async function updateHeaderMessage({ owner, repo, number }) {
  const { size, title, actions } = await PR.getPullRequestData({
    owner,
    repo,
    number,
  })
  const reducedActions = reduceActions(actions)
  const textParts = [
    `:${EMOJIS.info}: *Title*: ${title}\n\n`,
    `:${EMOJIS[`size_${size.label}`]}: *PR size*: ${size.label} (_${
      size.changes
    } changes_)\n\n`,
  ]

  if (reducedActions.length === 0) {
    textParts.push(`:${EMOJIS.waiting}: Waiting for reviewers`)
  } else {
    const groupedActions = groupByAction(reducedActions)
    const headerText = (
      await Promise.all(
        groupedActions.map(async ([action, ghUsers]) => {
          const { label, emoji } = getActionLabel(action)

          const slackUsers = await Promise.all(
            ghUsers.map(ghUser =>
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

  return PR.reply({
    pr: { owner, repo, number },
    replyId: 'header_message',
    textParts,
    payload: { title, size, actions },
  })
}
