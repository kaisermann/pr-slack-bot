import { WebClient, retryPolicies } from '@slack/web-api'

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
    .then(response => response.ok && response.profile) as Promise<SlackUser>
}

export async function* getFullUsers(): AsyncGenerator<SlackUser, any, void> {
  const slackUsers = await fetchAll(cursor =>
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
    .then(response => response.ok && response.usergroups)
}
