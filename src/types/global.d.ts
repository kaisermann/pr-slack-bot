type MaybeArray<T> = T | T[]

type TextBuilderArg = MaybeArray<string>

interface SlackUser {
  id: string
  profile: {
    status_text: string
    display_name: string
    fields: Record<string, { value: string }>
  }
}

interface SlackGroup {
  id: string
  handle: string
  name: string
  deleted_by?: string
  users: string[]
}

interface SlackMessage {
  user: string
  channel: string
  ts: string
  text: string
  blocks?: any[]
  thread_ts?: string
  event_ts?: string
}

type SlackMessagePayload = Omit<SlackMessage, 'user' | 'ts'> & { payload?: any }

interface SlackReply extends Omit<SlackMessage, 'user'> {
  payload?: any
}

interface PullRequestIdentifier {
  owner: string
  repo: string
  number: string
}

interface PullRequestActions {
  [user: string]: string[]
}

interface PullRequestAction {
  githubUser: string
  action: string
}

interface RepoIdentifier {
  owner: string
  repo: string
}
