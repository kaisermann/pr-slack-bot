import * as Slack from '../api'
import { getRandomItem } from '../../random.js'
import { db } from '../../../firebase'
import * as PR from '../../pr/pr'

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

module.exports = async ({
  channel,
  ts,
  thread_ts: threadTs,
  user_id,
  params,
}) => {
  const querySnapshot = await db
    .collection('prs')
    .where('thread.channel', '==', channel)
    .get()

  const pr = querySnapshot.docs[0]?.data() as PullRequestDocument

  if (pr == null) return

  // await pr.reply(`roulette_${ts}`, `:think-360:`);
  await PR.reply(pr, {
    replyId: `roulette_${ts}`,
    text: `:kuchiyose:`,
  })

  const [memberList] = await Promise.all([
    getMemberList(channel, params),
    wait(1900),
  ])

  const memberSet = new Set(memberList)

  memberSet.delete(user_id)
  memberSet.delete(pr.poster_id)

  let chosenMember
  let retryCount = -1

  // await pr.reply(`roulette_${ts}`, `:thinking-face-fast:`);

  do {
    if (retryCount++ >= 20 || memberSet.size === 0) {
      console.error(
        { channel, ts, thread_ts: threadTs },
        'Max members shuffling attempts reached'
      )
      chosenMember = null
      break
    }

    chosenMember = DB.users.get(['members', getRandomItem(memberSet)]).value()

    console.log(`Roulette: ${JSON.stringify(chosenMember)}`)

    // do not mention people on vacation
    if (chosenMember?.status_text.match(/vacation|f[ée]rias/gi)) {
      memberSet.delete(chosenMember.id)
      chosenMember = null
    }
  } while (!chosenMember)

  await PR.reply(pr, {
    replyId: `roulette_${ts}`,
    text: `:kuchiyose_smoke:`,
  })
  await wait(250)

  const text = chosenMember
    ? `:${getRandomItem(possibleEmojis)}: ${Slack.formatUserMention(
        chosenMember.id
      )}`
    : `For some reason I couldn't choose a random channel member... :sob:`

  await PR.reply(pr, { replyId: `roulette_${ts}`, text, payload: chosenMember })
  channel.save_pr(pr)
}
