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

interface MessageDocument extends Omit<SlackMessage, 'user'> {
  payload?: any
}

interface UserDocument {
  id: string
  github_user: string
  slack_user: string
  status_text: string
}

interface PullRequestIdentifier {
  owner: string
  repo: string
  number: string
}

interface PullRequestDocument {
  error: {
    status: number
    message?: string
  }
  owner: string
  repo: string
  number: string
  thread: {
    channel: string
    ts: string
    poster_id: string
    reactions: Record<string, string>
  }
  base_branch: string
  head_branch: string
  mergeable: boolean
  mergeable_state: string
  merged: boolean
  closed: boolean
  description: string
  title: string
  files: Array<{
    additions: number
    deletions: number
    filename: string
    status: 'modified' | 'added' | 'deleted'
  }>
  actions: Record<string, string[]>
  size: {
    label: string
    limit: number
    changes: number
    additions: number
    deletions: number
  }
}

interface PullRequestActions {
  [user: string]: string[]
}

interface PullRequestAction {
  githubUser: string
  action: string
}

interface RepoDocument {
  owner: string
  repo: string
  installationId: number | null
}
