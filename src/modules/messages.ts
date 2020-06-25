import { produce } from 'immer'

import * as Slack from './slack/api'

export async function sendMessage({
  text,
  blocks,
  channel,
  thread_ts,
  payload,
}: SlackMessagePayload): Promise<MessageDocument> {
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
  message: MessageDocument,
  fn
): Promise<MessageDocument> {
  const updatedMessage = produce<MessageDocument>(message, fn)

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

export const deleteMessage = async ({ channel, ts }: SlackMessage) => {
  const response = await Slack.botClient.chat
    .delete({ channel, ts })
    .catch((e) => e)

  if (!response.ok) throw response

  return true
}

export const buildText = (parts) => {
  parts = Array.isArray(parts) ? parts : [parts]

  return parts
    .filter(Boolean)
    .map((part) => (typeof part === 'function' ? part() : part))
    .join('')
}

export const blocks = {
  create_markdown_section: (text) => ({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: buildText(text),
    },
  }),
}
