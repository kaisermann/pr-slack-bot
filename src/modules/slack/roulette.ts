import * as Messages from '../messages'
import * as Slack from './api'
import { db } from '../../firebase'
import { getRandomItem } from '../random'

const possibleEmojis = [
  'worry-pls',
  'eyesright',
  'call_me_hand',
  'mini-hangloose',
  'awthanks',
  'gun',
  'pray',
  'eyes-inside',
  'pokebola',
  'drake-yes',
  'worry-mad',
  'mutley_laugh',
  'flushed-cross-eye-transparent',
  'eyes',
  'developers',
  'bushes_uncertain',
  'worry-glasses',
  'harold-pain',
  'this-is-fine-fire',
  'doge2',
  'worry-anime',
]

const wait = (delay) => new Promise((res) => setTimeout(res, delay))

const getMemberList = async (channelId: string, params) => {
  if (!params) {
    return Slack.getChannelMembers(channelId)
  }

  const groupMatch = Slack.matchGroupMention(params)

  if (groupMatch) {
    const [, groupId] = groupMatch
    const groupSnapshot = await db.collection('user_groups').doc(groupId).get()

    if (groupSnapshot.exists) {
      return groupSnapshot.data()?.users
    }

    return Slack.getUserGroupMembers(groupId)
  }

  const groupName = params
  const querySnapshot = await db
    .collection('user_groups')
    .where('handle', '==', groupName)
    .get()

  const [group] = querySnapshot.docs

  return group.data()?.users ?? []
}

export async function sendRoulette({
  channel_id: channelId,
  ts,
  thread_ts: threadTs,
  user_id,
  params,
}) {
  const querySnapshot = await db
    .collection('prs')
    .where('thread.channel', '==', channelId)
    .where('thread.ts', '==', threadTs)
    .get()

  const pr = querySnapshot.docs[0]?.data() as PullRequestDocument

  if (pr == null) return

  let rouletteMessage = await Messages.sendMessage({
    thread_ts: threadTs,
    channel: channelId,
    text: `:kuchiyose:`,
  })

  const [memberList] = await Promise.all([
    getMemberList(channelId, params),
    wait(1900),
  ])

  const memberIds: Set<string> = new Set(memberList)

  memberIds.delete(user_id)
  memberIds.delete(pr.thread.poster_id)

  let chosenMember: UserDocument | null = null
  let retryCount = -1

  do {
    if (retryCount++ >= 20 || memberIds.size === 0) {
      console.error(
        { channel: channelId, ts, thread_ts: threadTs },
        'Max members shuffling attempts reached'
      )
      chosenMember = null
      break
    }

    // eslint-disable-next-line no-await-in-loop
    const userSnap = await db
      .collection('users')
      .doc(getRandomItem(memberIds))
      .get()

    // eslint-disable-next-line no-await-in-loop
    chosenMember = userSnap.data() as UserDocument

    console.log(`Roulette: ${JSON.stringify(chosenMember)}`)

    // do not mention people on vacation
    if (chosenMember?.status_text.match(/vacation|f[ée]rias/gi)) {
      memberIds.delete(chosenMember.id)
      chosenMember = null
    }
  } while (!chosenMember)

  rouletteMessage = await Messages.updateMessage(rouletteMessage, (draft) => {
    draft.text = `:kuchiyose_smoke:`
  })

  await wait(250)

  await Messages.updateMessage(rouletteMessage, (draft) => {
    if (chosenMember) {
      const emoji = getRandomItem(possibleEmojis)

      draft.text = `:${emoji}: ${Slack.formatUserMention(chosenMember.id)}`
    } else {
      draft.text = `For some reason I couldn't choose a random channel member... :sob:`
    }
  })
}
