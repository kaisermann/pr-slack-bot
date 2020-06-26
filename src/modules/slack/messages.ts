import { produce } from 'immer'

import * as Slack from './api'

export async function sendMessage({
  text,
  blocks,
  channel,
  thread_ts,
  payload,
}: SlackMessagePayload): Promise<SlackReply> {
  if (channel == null) {
    throw new Error()
  }

  const response = await Slack.botClient.chat
    .postMessage({
      text: text ?? '',
      blocks,
      channel,
      thread_ts,
      unfurl_links: false,
      // send as paulo ricardo
      as_user: true,
      link_names: true,
    })
    .catch((e) => e)

  if (!response.ok) throw response

  const { ts } = response

  return {
    payload,
    thread_ts,
    ts,
    channel,
    blocks,
    text,
  }
}

export async function updateMessage(
  message: SlackReply,
  fn
): Promise<SlackReply> {
  const updatedMessage = produce<SlackReply>(message, fn)

  const response = await Slack.botClient.chat
    .update({
      text: updatedMessage.text,
      blocks: updatedMessage.blocks,
      channel: updatedMessage.channel,
      ts: updatedMessage.ts,
      unfurl_links: false,
      as_user: true,
      link_names: true,
    })
    .catch((e) => e)

  if (!response.ok) throw response

  return updatedMessage
}

export const deleteMessage = async ({
  channel,
  ts,
}: {
  channel: string
  ts: string
}) => {
  const response = await Slack.botClient.chat
    .delete({ channel, ts })
    .catch((e) => e)

  if (!response.ok) throw response

  return true
}

export const buildText = (parts: TextBuilderArg) => {
  parts = Array.isArray(parts) ? parts : [parts]

  return parts.filter(Boolean).join('')
}

export const blocks = {
  createMarkdownSection: (text) => ({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: buildText(text),
    },
  }),
}

export function getMessageDate(msg: ChannelMessageDocument) {
  return new Date(parseFloat(msg.ts) * 1000)
}

export function getTimeSincePost(
  msg: ChannelMessageDocument,
  {
    dateRef = new Date(),
    unit = 'hours',
  }: { dateRef?: Date; unit?: 'hours' | 'minutes' } = {}
) {
  const diff = getMessageDate(msg).getTime() - dateRef.getTime()
  const diffMins = Math.abs(diff) / (1000 * 60)

  if (unit === 'hours') {
    return ~~(diffMins / 60)
  }

  return diffMins
}
