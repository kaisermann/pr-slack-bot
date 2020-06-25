import DB from '../../api/db.js'
import runtime from '../../runtime.js'
import Message from '../../includes/message.js'
import get_sectioned_pr_blocks from '../../messages/section_pr_list.js'

export default async ({ channel_id: channelId, user_id: userId, params }) => {
  const channel = runtime.get_channel(channelId)

  if (!channel) {
    return `Sorry, but it seems I'm not tracking any PR from this channel.`
  }

  if (params.length === 0) {
    return [
      Message.blocks.create_markdown_section(
        `Here's all PRs listed on this channel:`
      ),
    ].concat(await get_sectioned_pr_blocks(channel.prs))
  }

  if (params === 'mine') {
    const prs = channel.prs.filter((pr) => pr.poster_id === userId)

    if (prs.length === 0) {
      return "You don't have any pull requests listed on this channel"
    }

    return [
      Message.blocks.create_markdown_section(`Here's all PRs owned by you:`),
    ].concat(await get_sectioned_pr_blocks(prs))
  }

  const groupMatch = Message.match_group_mention(params)

  if (groupMatch) {
    const [, matchedGroupId] = groupMatch
    const members = new Set(
      DB.users.get(['groups', matchedGroupId, 'users'], []).value()
    )

    const prs = channel.prs.filter((pr) => members.has(pr.poster_id))

    if (prs.length === 0) {
      return `${Message.get_group_mention(
        matchedGroupId
      )} don't have any pull requests listed on this channel`
    }

    return [
      Message.blocks.create_markdown_section(
        `Here's all PRs owned by ${Message.get_group_mention(matchedGroupId)}:`
      ),
    ].concat(await get_sectioned_pr_blocks(prs))
  }

  const userMatch = Message.match_user_mention(params)

  if (userMatch) {
    const [, matchedUserId] = userMatch
    const prs = channel.prs.filter((pr) => pr.poster_id === matchedUserId)

    if (prs.length === 0) {
      return `${Message.get_user_mention(
        matchedUserId
      )} don't have any pull requests listed on this channel`
    }

    return [
      Message.blocks.create_markdown_section(
        `Here's all PRs owned by ${Message.get_user_mention(matchedUserId)}:`
      ),
    ].concat(await get_sectioned_pr_blocks(prs))
  }

  return 'Invalid command parameters: `/pr list [ |mine|@user|@userGroup]`'
}
