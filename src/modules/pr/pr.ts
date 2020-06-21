import { basename } from 'path'

import isDeepEqual from 'fast-deep-equal'

import { db } from '../../firebase'
import { getPullRequestMetaData, getReviewData, getFilesData } from '../github'
import * as Message from '../message'
import { reevaluateReplies } from './replies'
import { getActionMap } from './actions'
import { PR_SIZES } from '../../consts'

const PR_REGEX = /github\.com\/([\w-.]*)?\/([\w-.]*?)\/pull\/(\d+)/i

export function getPullRequestID(pr) {
  return `${pr.owner}@${pr.repo}@${pr.number}`
}

export function getPullRequestRef(
  pr: string | { owner: string; repo: string; number: string }
) {
  const id = typeof pr === 'string' ? pr : getPullRequestID(pr)

  return db.collection('prs').doc(id)
}

export async function getPullRequestData(pr) {
  let ref

  if (typeof pr.get === 'function') {
    ref = pr
  } else {
    ref = getPullRequestRef(pr)
  }

  return (await ref.get()).data() as PullRequestDocument
}

function getReplyRef(pr, replyId) {
  return getPullRequestRef(pr)
    .collection('replies')
    .doc(replyId)
}

export function isPullRequestMessage(message) {
  return Boolean(message.thread_ts == null && message.text?.match(PR_REGEX))
}

export async function addPullRequestFromEventMessage(message: SlackMessage) {
  const match = message.text?.match(PR_REGEX)

  if (!match) return

  const [, owner, repo, number] = match
  const id = `${owner}@${repo}@${number}`
  const prRef = getPullRequestRef(id)

  if ((await prRef.get()).exists) {
    console.info('Deleting previous reply history')
    await deleteReplies(id)
  }

  const pr: Partial<PullRequestDocument> = {
    owner,
    repo,
    number,
    thread: {
      channel: message.channel,
      ts: message.ts,
      poster_id: message.user,
    },

    ...(await getPullRequestConsolidatedState({ owner, repo, number })),
  }

  await prRef.set(pr)

  return reevaluatePullRequest({ owner, repo, number })
}

async function reevaluatePullRequest({ owner, repo, number }) {
  await reevaluateReplies({ owner, repo, number })
}

async function fetchPullRequestRemoteState(pr) {
  const { owner, repo, number } = pr
  const params = { owner, repo, number }

  const responses = await Promise.all([
    getPullRequestMetaData(params),
    getReviewData(params),
    getFilesData(params),
  ])

  const hasStatus = status => responses.some(r => r.status === status)

  if (hasStatus(520)) return { error: { status: 520 } }
  if (hasStatus(403)) return { error: { status: 403 } }
  if (hasStatus(404)) return { error: { status: 404 } }

  const [prResponse, reviewResponse, filesResponse] = responses

  const metaData = prResponse.data
  const reviewData = reviewResponse.data
  const filesData = filesResponse.data

  if (metaData == null || reviewData == null || filesData == null) {
    throw new Error(
      `Something went wrong with ${getPullRequestID(pr)} github requests.`
    )
  }

  return { metaData, reviewData, filesData }
}

async function getPullRequestConsolidatedState(pr) {
  const {
    error,
    metaData,
    reviewData,
    filesData,
  } = await fetchPullRequestRemoteState(pr)

  if (error) return { error }

  const { title, body, additions, deletions, mergeable } = metaData
  const mappedFiles = filesData.map(
    ({ filename, additions: add, deletions: del }) => {
      return { filename, additions: add, deletions: del }
    }
  )

  const actions = getActionMap({ metaData, reviewData })

  return {
    title,
    actions,
    description: body,
    files: mappedFiles,
    mergeable,
    merged: metaData.merged,
    closed: metaData.state === 'closed',
    mergeable_state: metaData.mergeable_state,
    head_branch: metaData.head.ref,
    base_branch: metaData.base.ref,
    size: calculatePullRequestSize({
      files: mappedFiles,
      additions,
      deletions,
    }),
  }
}

async function deletePullRequestReply(pr, id) {
  const replyRef = getReplyRef(pr, id)
  const replySnapshot = await replyRef.get()

  if (!replySnapshot.exists) {
    return false
  }

  const replyData = replySnapshot.data() as any

  return Message.deleteMessage(replyData)
    .then(() => {
      return replyRef.delete().then(() => true)
    })
    .catch(e => {
      console.log(e.data)
      console.log(e.data.error)
      if (e.data && e.data.error === 'message_not_found') {
        console.error(`- Tried to delete an already deleted message`)

        return replyRef.delete().then(() => false)
      }

      throw e
    })
}

async function deleteReplies(pr, replyIds: string[] = []) {
  if (replyIds.length === 0) {
    const repliesSnapshot = await getPullRequestRef(pr)
      .collection('replies')
      .get()

    replyIds = repliesSnapshot.docs.map(doc => doc.id)
  }

  return Promise.all(
    replyIds.map(replyId => deletePullRequestReply(pr, replyId))
  )
}

async function updateReply({ pr, replyId, update, payload }) {
  const replyRef = getReplyRef(pr, replyId)
  const replySnapshot = await replyRef.get()

  if (!replySnapshot.exists) {
    return false
  }

  const replyData = replySnapshot.data() as PullRequestReply

  if (
    replyData.payload != null &&
    payload != null &&
    isDeepEqual(replyData.payload, payload)
  ) {
    return false
  }

  const text = Message.buildText(update(replyData))

  if (replyData.text === text) {
    return false
  }

  if (text === '') {
    return deletePullRequestReply(pr, replyId)
  }

  console.info(`- Updating reply: ${text}`)

  const updatedMessage = await Message.updateMessage(replyData, message => {
    message.text = text
    message.payload = payload
  })

  await replyRef.set(updatedMessage)

  return true
}

export async function reply({ pr, replyId, textParts, payload }) {
  const replyRef = getReplyRef(pr, replyId)
  const replySnapshot = await replyRef.get()

  if (replySnapshot.exists) {
    return updateReply({ pr, replyId, update: () => textParts, payload })
  }

  const prSnapshot = await getPullRequestData(pr)

  if (prSnapshot == null) {
    return false
  }

  const text = Message.buildText(textParts)

  if (text === '') return false

  console.info(`- Sending reply: ${text}`)

  const {
    thread: { channel, ts },
  } = prSnapshot

  return Message.sendMessage({
    text,
    channel,
    thread_ts: ts,
    payload,
  })
    .then(msg => getReplyRef(pr, replyId).set(msg))
    .then(() => true)
}

function calculatePullRequestSize({
  files,
  additions,
  deletions,
}: {
  files: PullRequestDocument['files']
  additions: number
  deletions: number
}) {
  const lockFileChanges = files
    .filter(f => {
      const filename = basename(f.filename)

      return filename === 'package-lock.json' || filename === 'yarn.lock'
    })
    .reduce((acc, file) => acc + file.additions + file.deletions, 0)

  const changes = additions + deletions - lockFileChanges

  let i

  for (i = 0; i < PR_SIZES.length && changes > PR_SIZES[i][1]; i++);

  return {
    label: PR_SIZES[i][0] as string,
    limit: PR_SIZES[i][1] as number,
    changes,
    additions,
    deletions,
  }
}

// function get_approvals() {
//   return state.actions.filter(a => a.action === ACTIONS.approved).length
// }

// function has_changelog() {
//   return state.files.some(f => {
//     const filename = basename(f.filename).toLowerCase()

//     return (
//       filename === 'changelog.md' &&
//       (f.status === 'modified' || f.status === 'added')
//     )
//   })
// }

// function has_comment() {
//   return state.actions.some(item => item.action === ACTIONS.commented)
// }

// function has_changes_requested() {
//   return state.actions.some(item => item.action === ACTIONS.changes_requested)
// }

// function is_trivial() {
//   return (state.title + state.description).includes('#trivial')
// }

// function is_draft() {
//   return state.mergeable_state === 'draft'
// }

// function is_mergeable() {
//   if (state.closed) return false
//   return state.mergeable_state === 'clean'
// }

// function is_dirty() {
//   return state.mergeable_state === 'dirty'
// }

// function is_unstable() {
//   return state.mergeable_state === 'unstable'
// }

// function is_resolved() {
//   return state.closed || state.merged
// }

// function is_active() {
//   return !is_draft()
// }

// function is_waiting_review() {
//   return (
//     state.actions.length === 0 ||
//     state.actions.some(
//       item =>
//         item.action === ACTIONS.dismissed ||
//         item.action === ACTIONS.review_requested
//     )
//   )
// }

// async function can_be_merged() {
//   const { base_branch } = state
//   if (base_branch !== 'master' && base_branch.match(/\d\.x/i) == null) {
//     return { can_merge: true }
//   }

//   const defcon_status = await check_defcon()
//   if (defcon_status == null) return { can_merge: true }

//   return {
//     can_merge:
//       defcon_status.level !== 'critical' && defcon_status.level !== 'warning',
//     defcon: defcon_status,
//   }
// }

// function has_pending_review() {
//   return state.actions.some(item => item.action === ACTIONS.pending_review)
// }
