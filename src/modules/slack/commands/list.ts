import { firestore } from 'firebase-admin'

import * as Slack from '../api'
import * as Messages from '../messages'
import * as Users from '../../users'
import { formatPullRequestListSections } from '../messages/prSectionList'
import { getChannelActiveMessages } from '../../channels'

export async function getPullRequestDocumentFromMessage(
  msgDoc: ChannelMessageDocument
): Promise<[ChannelMessageDocument, PullRequestDocument]> {
  const prDoc = await msgDoc.prRef
    .get()
    .then((snap) => snap.data() as PullRequestDocument)

  return [msgDoc, prDoc]
}

export function getPullRequestFromMessagesQuery(
  query: firestore.QuerySnapshot
) {
  return Promise.all(
    query.docs.map((doc) =>
      getPullRequestDocumentFromMessage(doc.data() as ChannelMessageDocument)
    )
  )
}

// todo: find a way to ignore messages for prs already merged
export default async ({ channel_id: channelId, user_id: userId, params }) => {
  const messageCollection = getChannelActiveMessages({ channelId })

  if (params.length === 0) {
    const prDocs = await getPullRequestFromMessagesQuery(
      await messageCollection.get()
    )

    if (prDocs.length === 0) {
      return "There's no open PRs in this channel right now."
    }

    return [
      Messages.blocks.createMarkdownSection(
        `Here's all PRs listed on this channel:`
      ),
    ].concat(await formatPullRequestListSections(prDocs))
  }

  if (params === 'mine') {
    const querySnap = await messageCollection
      .where('poster_id', '==', userId)
      .get()

    if (querySnap.empty) {
      return "You don't have any pull requests listed on this channel"
    }

    const prDocs = await getPullRequestFromMessagesQuery(querySnap)

    return [
      Messages.blocks.createMarkdownSection(`Here's all PRs owned by you:`),
    ].concat(await formatPullRequestListSections(prDocs))
  }

  const groupMatch = Slack.matchGroupMention(params)

  if (groupMatch) {
    const [, matchedGroupId] = groupMatch
    const userGroupSnap = await Users.getUserGroupRef(matchedGroupId).get()
    const userGroupData = userGroupSnap.data() as UserGroupDocument
    const querySnap = await messageCollection
      .where('poster_id', 'in', userGroupData.users)
      .get()

    if (querySnap.empty) {
      return `${Slack.formatGroupMention(
        matchedGroupId
      )} don't have any pull requests listed on this channel`
    }

    const prDocs = await getPullRequestFromMessagesQuery(querySnap)

    return [
      Messages.blocks.createMarkdownSection(
        `Here's all PRs owned by ${Slack.formatUserMention(matchedGroupId)}:`
      ),
    ].concat(await formatPullRequestListSections(prDocs))
  }

  const userMatch = Slack.matchUserMention(params)

  if (userMatch) {
    const [, matchedUserId] = userMatch
    const querySnap = await messageCollection
      .where('poster_id', '==', matchedUserId)
      .get()

    if (querySnap.empty) {
      return `${Slack.formatUserMention(
        matchedUserId
      )} don't have any pull requests listed on this channel`
    }

    const prDocs = await getPullRequestFromMessagesQuery(querySnap)

    return [
      Messages.blocks.createMarkdownSection(
        `Here's all PRs owned by ${Slack.formatUserMention(matchedUserId)}:`
      ),
    ].concat(await formatPullRequestListSections(prDocs))
  }

  return 'Invalid command parameters: `/pr list [ |mine|@user|@userGroup]`'
}
