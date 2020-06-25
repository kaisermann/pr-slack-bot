// import { createHash } from 'crypto'

import { WebClient, retryPolicies } from '@slack/web-api'

// function md5(data: string) {
//   return createHash('md5')
//     .update(data)
//     .digest('hex')
// }

const { SLACK_BOT_TOKEN, SLACK_USER_TOKEN } = process.env

export const userClient = new WebClient(SLACK_USER_TOKEN, {
  retryConfig: retryPolicies.rapidRetryPolicy,
})

export const botClient = new WebClient(SLACK_BOT_TOKEN, {
  retryConfig: retryPolicies.rapidRetryPolicy,
})

async function fetchAll(fn): Promise<any[]> {
  const results: any[] = []
  let cursor

  do {
    // eslint-disable-next-line no-await-in-loop
    const response = await fn(cursor)

    if (!response.ok) throw response.error

    const {
      members,
      response_metadata: { next_cursor: nextCursor },
    } = response

    cursor = nextCursor
    results.push(...members)
  } while (cursor !== '')

  return results
}

export function getProfileInfo({ id }) {
  return userClient.users.profile
    .get({ user: id })
    .then((response) => response.ok && response.profile) as Promise<SlackUser>
}

export async function* getFullUsers(): AsyncGenerator<SlackUser, any, void> {
  const slackUsers = await fetchAll((cursor) =>
    botClient.users.list({ limit: 0, cursor })
  )

  for await (const user of slackUsers) {
    if (user.deleted) {
      continue
    }

    const fullProfile = await getProfileInfo({ id: user.id })

    Object.assign(user.profile, fullProfile)

    yield user
  }
}

export async function getUserGroups(): Promise<any> {
  return botClient.usergroups
    .list({
      include_disabled: false,
      include_count: false,
      include_users: true,
    })
    .then((response) => response.ok && response.usergroups)
}

export async function sendMessage({
  text,
  blocks,
  channel,
  thread_ts,
}: Partial<SlackMessage>) {
  if (channel == null) {
    throw new Error()
  }

  const response = await botClient.chat
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
    thread_ts,
    ts,
    channel,
    blocks,
    text,
  }
}

export function updateMessage({ channel, ts, text, blocks }) {
  return botClient.chat
    .update({
      text,
      blocks,
      channel,
      ts,
      unfurl_links: false,
      as_user: true,
      link_names: true,
    })
    .catch((e) => e)
}

export function deleteMessage({ channel, ts }) {
  return botClient.chat.delete({ channel, ts }).catch((e) => e)
}

export function deleteMessageByURL(url) {
  const match = url.match(
    /archives\/(.*?)\/p(.*?)(?:\/|#|$|\?.*?thread_ts=(.*?)(?:&|$)|\?)/i
  )

  if (!match) return

  let [, channel, ts] = match

  ts = (+ts / 1000000).toFixed(6)

  deleteMessage({ channel, ts })
}

export async function getMessageURL({ channel, ts }) {
  const response = await botClient.chat.getPermalink({
    channel,
    message_ts: ts,
  })

  const url = response.permalink as string

  return url.replace(/\?.*$/, '')
}

export function removeReaction({ emoji, channel, ts }) {
  return botClient.reactions.remove({ name: emoji, timestamp: ts, channel })
}

export function addReaction({ emoji, channel, ts }) {
  return botClient.reactions.add({ name: emoji, timestamp: ts, channel })
}

export const matchUserMention = (str) => str.match(/^<@(\w*?)\|[\w.-_]*?>$/i)
export const formatUserMention = (id) => `<@${id}>`

export const matchGroupMention = (str) => str.match(/<!subteam\^(.*?)\|.*?>/i)
export const formatGroupMention = (id) => `<!subteam^${id}>`
