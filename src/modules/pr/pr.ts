import { basename } from 'path'

import isDeepEqual from 'fast-deep-equal'

import { getDefconStatus } from '../defcon'
import { db } from '../../firebase'
import { reevaluateReplies } from './replies'
import { getActionMap } from './actions'
import { PR_SIZES } from '../../consts'
import { reevaluateReactions } from './reactions'
import { AsyncLock } from '../lock'
import * as Github from '../github/api'
import * as Messages from '../messages'

const PR_REGEX = /github\.com\/([\w-.]*)?\/([\w-.]*?)\/pull\/(\d+)/i

const PR_LOCKS: Map<string, AsyncLock> = new Map()

export function isPullRequestMessage(message: SlackMessage) {
  return Boolean(message.thread_ts == null && message.text?.match(PR_REGEX))
}

export function getPullRequestID({
  owner,
  repo,
  number,
}: {
  owner: string
  repo: string
  number: string
}) {
  return `${owner}@${repo}@${number}`
}

export function getRepoID({ owner, repo }: { owner: string; repo: string }) {
  return `${owner}@${repo}`
}

export function getRepoRef({ owner, repo }: { owner: string; repo: string }) {
  return db.collection('repos').doc(getRepoID({ owner, repo }))
}

export function getPullRequestRef({
  owner,
  repo,
  number,
}: {
  owner: string
  repo: string
  number: string
}) {
  return getRepoRef({ owner, repo }).collection('prs').doc(`${number}`)
}

export async function getPullRequestDocument(pr) {
  let ref

  if (typeof pr.get === 'function') {
    ref = pr
  } else {
    ref = getPullRequestRef(pr)
  }

  const prSnap = await ref.get()

  return prSnap.data() as PullRequestDocument
}

function getReplyRef(pr, replyId) {
  return getPullRequestRef(pr).collection('replies').doc(replyId)
}

export async function addPullRequestFromEventMessage(message: SlackMessage) {
  const match = message.text?.match(PR_REGEX)

  if (!match) {
    return
  }

  const [, owner, repo, number] = match

  const repoRef = db.collection('repos').doc(`${owner}@${repo}`)

  repoRef.set({
    owner,
    repo,
    installationId: null,
  })

  const prRef = getPullRequestRef({ owner, repo, number })

  if ((await prRef.get()).exists) {
    console.info('Deleting previous reply history')
    await deleteReplies({ owner, repo, number })
  }

  const pr = {
    owner,
    repo,
    number,
    thread: {
      reactions: {},
      channel: message.channel,
      ts: message.ts,
      poster_id: message.user,
    },
  } as PullRequestDocument

  Object.assign(pr, await getPullRequestConsolidatedState(pr))

  await prRef.set(pr)

  return evaluatePullRequest(pr)
}

export async function evaluatePullRequest(pr: PullRequestDocument) {
  const id = getPullRequestID(pr)
  const lock = PR_LOCKS.get(id)

  try {
    if (lock) {
      await lock.acquire()
    }

    await Promise.all([reevaluateReplies(pr), reevaluateReactions(pr)])
  } catch (e) {
    console.error(e)
    throw e
  } finally {
    if (lock) {
      await lock.release()

      if (lock.acquired) {
        PR_LOCKS.delete(id)
      }
    }
  }
}

export async function evaluatePullRequests(prs: PullRequestDocument[]) {
  for (const prDoc of prs) {
    evaluatePullRequest(prDoc)
  }
}

async function fetchPullRequestRemoteState(pr: PullRequestIdentifier) {
  const { owner, repo, number } = pr

  const params = { owner, repo, number }

  const responses = await Github.getPullRequestState(params)

  const hasStatus = (status) => responses.some((r) => r.status === status)

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

async function getPullRequestConsolidatedState(pr: PullRequestIdentifier) {
  const {
    error,
    metaData,
    reviewData,
    filesData,
  } = await fetchPullRequestRemoteState(pr)

  if (error) return { error }

  const {
    title,
    body,
    additions: totalAdditions,
    deletions: totalDeletions,
    mergeable,
  } = metaData

  const mappedFiles = filesData.map(
    ({ filename, additions, deletions, status }) => {
      return { filename, additions, deletions, status }
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
      additions: totalAdditions,
      deletions: totalDeletions,
    }),
  }
}

export async function deleteReply(
  pr: PullRequestIdentifier,
  { replyId }: { replyId: string }
) {
  const replyRef = getReplyRef(pr, replyId)
  const replySnapshot = await replyRef.get()

  if (!replySnapshot.exists) {
    return false
  }

  const replyData = replySnapshot.data() as any

  return Messages.deleteMessage(replyData)
    .then(() => {
      return replyRef.delete().then(() => true)
    })
    .catch((e) => {
      console.log(e.data)
      console.log(e.data.error)
      if (e.data && e.data.error === 'message_not_found') {
        console.error(`- Tried to delete an already deleted message`)

        return replyRef.delete().then(() => false)
      }

      throw e
    })
}

async function deleteReplies(
  pr: PullRequestIdentifier,
  replyIds: string[] = []
) {
  if (replyIds.length === 0) {
    const repliesSnapshot = await getPullRequestRef(pr)
      .collection('replies')
      .get()

    replyIds = repliesSnapshot.docs.map((doc) => doc.id)
  }

  return Promise.all(replyIds.map((replyId) => deleteReply(pr, { replyId })))
}

async function updateReply(
  pr: PullRequestDocument,
  {
    replyId,
    update,
    payload,
  }: {
    replyId: string
    update: (...args: any[]) => any
    payload: any
  }
) {
  const replyRef = getReplyRef(pr, replyId)
  const replySnapshot = await replyRef.get()

  if (!replySnapshot.exists) {
    return false
  }

  const replyData = replySnapshot.data() as MessageDocument

  if (
    replyData.payload != null &&
    payload != null &&
    isDeepEqual(replyData.payload, payload)
  ) {
    return false
  }

  const text = Messages.buildText(update(replyData))

  if (replyData.text === text) {
    return false
  }

  if (text === '') {
    return deleteReply(pr, { replyId })
  }

  console.info(`- Updating reply: ${text}`)

  const updatedMessage = await Messages.updateMessage(replyData, (message) => {
    message.text = text
    message.payload = payload
  })

  await replyRef.set(updatedMessage)

  return true
}

export async function reply(
  pr,
  {
    replyId,
    text,
    payload,
  }: {
    replyId: string
    text: any | any[]
    payload?: any
  }
) {
  const replyRef = getReplyRef(pr, replyId)
  const replySnapshot = await replyRef.get()

  if (replySnapshot.exists) {
    return updateReply(pr, { replyId, update: () => text, payload })
  }

  const builtText = Messages.buildText(text)

  if (builtText === '') return false

  console.info(`- Sending reply: ${builtText}`)

  const {
    thread: { channel, ts },
  } = pr

  return Messages.sendMessage({
    text: builtText,
    channel,
    thread_ts: ts,
    payload,
  })
    .then((msg) => getReplyRef(pr, replyId).set(msg))
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
    .filter((f) => {
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

export function hasChangelog(pr: PullRequestDocument) {
  const { files } = pr

  return files.some((f) => {
    const filename = basename(f.filename).toLowerCase()

    return (
      filename === 'changelog.md' &&
      (f.status === 'modified' || f.status === 'added')
    )
  })
}

export function isTrivial(pr: PullRequestDocument) {
  return (pr.title + pr.description).includes('#trivial')
}

export function isDraft(pr: PullRequestDocument) {
  return pr.mergeable_state === 'draft'
}

export function isMergeable(pr: PullRequestDocument) {
  if (pr.closed) return false

  return pr.mergeable_state === 'clean'
}

export function isDirty(pr: PullRequestDocument) {
  return pr.mergeable_state === 'dirty'
}

export function isUnstable(pr: PullRequestDocument) {
  return pr.mergeable_state === 'unstable'
}

export function isResolved(pr: PullRequestDocument) {
  return pr.closed || pr.merged
}

export function isActive(pr: PullRequestDocument) {
  return !isDraft(pr)
}

export async function canBeMerged(pr: PullRequestDocument) {
  if (pr.base_branch !== 'master' && pr.base_branch.match(/\d\.x/i) == null) {
    return { canMerge: true, defcon: null }
  }

  const defconStatus = await getDefconStatus()

  if (defconStatus == null) {
    return { canMerge: true, defcon: null }
  }

  return {
    canMerge:
      defconStatus.level !== 'critical' && defconStatus.level !== 'warning',
    defcon: defconStatus,
  }
}
