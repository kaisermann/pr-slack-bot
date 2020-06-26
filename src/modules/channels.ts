import { db } from '../firebase'

export function getChannelRef({ channelId }: { channelId: string }) {
  return db.collection('channels').doc(channelId)
}

export function getChannelMessageCollection({
  channelId,
}: {
  channelId: string
}) {
  return getChannelRef({ channelId }).collection('messages')
}

export function getChannelMessageRef({ channelId, ts }) {
  return getChannelMessageCollection({ channelId }).doc(ts)
}

export function getChannelActiveMessages({ channelId }: { channelId: string }) {
  return getChannelMessageCollection({ channelId }).where('done', '==', false)
}
