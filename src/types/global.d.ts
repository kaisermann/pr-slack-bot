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

interface SlackMessageEvent {
  user: string
  channel: string
  message_ts: string
  thread_ts?: string
  event_ts?: string
}

interface LinkSharedMessageEvent extends SlackMessageEvent {
  links: Array<{
    url: string
    domain: string
  }>
}
