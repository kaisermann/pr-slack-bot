import { db } from '../firebase'
import { getPullRequestData, getReviewData, getFilesData } from './github'

const ACTIONS = Object.freeze({
  approved: 'APPROVED',
  dismissed: 'DISMISSED',
  changes_requested: 'CHANGES_REQUESTED',
  pending_review: 'PENDING',
  review_requested: 'REVIEW_REQUESTED',
  commented: 'COMMENTED',
  merged: 'MERGED',
  unknown: 'UNKNOWN',
})

const PR_REGEX = /github\.com\/([\w-.]*)?\/([\w-.]*?)\/pull\/(\d+)/i

export function isPullRequestMessage(
  message
): message is LinkSharedMessageEvent {
  return Boolean(
    message.thread_ts == null &&
      message.links?.find(({ url }) => url.match(PR_REGEX))
  )
}

export async function addPullRequestFromEventMessage(
  message: LinkSharedMessageEvent
) {
  const matches = message.links?.map(l => l.url.match(PR_REGEX)).filter(Boolean)

  if (matches == null || matches.length === 0) {
    return
  }

  const [firstMatch] = matches
  const [, owner, repo, number] = firstMatch
  const slug = `${owner}@${repo}@${number}`

  return db
    .collection('prs')
    .doc(slug)
    .set({
      poster_id: message.user,
      owner,
      repo,
      number,
      ts: message.message_ts,
      channel: message.channel,
    })
}

async function fetchPullRequestRemoteState(pr) {
  const { owner, repo, number } = pr
  const params = { owner, repo, number }

  const responses = await Promise.all([
    getPullRequestData(params),
    getReviewData(params),
    getFilesData(params),
  ])

  const hasStatus = status => responses.some(r => r.status === status)

  if (hasStatus(520)) return { error: { status: 520 } }
  if (hasStatus(403)) return { error: { status: 403 } }
  if (hasStatus(404)) return { error: { status: 404 } }

  const [prResponse, reviewResponse, filesResponse] = responses

  const prData = prResponse.data
  const reviewData = reviewResponse.data
  const filesData = filesResponse.data

  if (prData == null || reviewData == null || filesData == null) {
    throw new Error(`Something went wrong with ${slug} github requests.`)
  }

  return { prData, reviewData, filesData }
}

function getAction(action_list) {
  const last_approved_idx = action_list.lastIndexOf(ACTIONS.approved)
  const last_change_request_idx = action_list.lastIndexOf(
    ACTIONS.changes_requested
  )

  if (last_change_request_idx > last_approved_idx) {
    return ACTIONS.changes_requested
  }

  const last_dismissed_idx = action_list.lastIndexOf(ACTIONS.dismissed)

  if (last_dismissed_idx < last_approved_idx) {
    return ACTIONS.approved
  }

  if (last_dismissed_idx >= 0) {
    return ACTIONS.dismissed
  }

  if (action_list.includes(ACTIONS.review_requested)) {
    return ACTIONS.review_requested
  }

  if (action_list.includes(ACTIONS.pending_review)) {
    return ACTIONS.pending_review
  }

  if (action_list.includes(ACTIONS.commented)) {
    return ACTIONS.commented
  }

  return ACTIONS.unknown
}

function getActionList(meta, review) {
  const actions = {}

  meta.requested_reviewers.forEach(({ login }) => {
    actions[login] = [ACTIONS.review_requested]
  })

  review
    .filter(({ user }) => meta.assignee == null || user !== meta.assignee.login)
    .forEach(({ user: { login }, state }) => {
      if (!(login in actions)) actions[login] = []
      actions[login].push(state)
    })

  return Object.entries(actions)
}

async function getPullRequestConsolidatedState(pr) {
  const { owner, repo, number } = pr
  const {
    error,
    prData,
    reviewData,
    filesData,
  } = await fetchPullRequestRemoteState(pr)

  if (error) return { error }

  // review data mantains a list of reviews
  const actionLists = getActionList(prData, reviewData)

  const actions: any[] = actionLists
    .map(([githubUser, actionList]) => {
      return {
        githubUser,
        action: getAction(actionList),
      }
    })
    .concat(
      (prData.merged_by != null && {
        githubUser: prData.merged_by.login,
        action: ACTIONS.merged,
      }) ||
        []
    )
    .map(async ({ githubUser, action }) => {
      const userQuery = await db
        .collection('users')
        .where('github_user', '==', githubUser)
        .get()

      if (!userQuery.empty) {
        // TODO: PAREI AQUI
        return { ...userQuery, action }
      }

      return { githubUser, action }
    })

  const { title, body, additions, deletions, mergeable } = prData
  const mappedFiles = filesData.map(
    ({ filename, status, additions: add, deletions: del }) => {
      return { filename, status, additions: add, deletions: del }
    }
  )

  return {
    title,
    description: body,
    actions,
    additions,
    deletions,
    files: mappedFiles,
    mergeable,
    merged: prData.merged,
    closed: prData.state === 'closed',
    mergeable_state: prData.mergeable_state,
    head_branch: prData.head.ref,
    base_branch: prData.base.ref,
  }
}
