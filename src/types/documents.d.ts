type DocumentReference = import('firebase-admin').firestore.DocumentReference

interface UserDocument {
  id: string
  github_user: string
  slack_user: string
  status_text: string
}

interface UserGroupDocument {
  id: string
  handle: string
  name: string
  users: string[]
}

interface PullRequestDocument {
  error: {
    status: number
    message?: string
  }
  owner: string
  repo: string
  number: string
  messageRefs: DocumentReference[]
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

interface RepoDocument {
  owner: string
  repo: string
  installationId: number | null
}

interface ChannelMessageDocument {
  done: boolean
  poster_id: string
  reactions: Record<string, string>
  ts: string
  channel: string
  prRef: DocumentReference
  replies: Record<
    string,
    {
      text: string
      payload?: unknown
      blocks?: any
      ts: string
    }
  >
}
