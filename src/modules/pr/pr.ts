import { basename } from 'path'

import { produce } from 'immer'
import isDeepEqual from 'fast-deep-equal'
import { firestore } from 'firebase-admin'

import { getDefconStatus } from '../defcon'
import { getActionMap } from './actions'
import { PR_SIZES } from '../../consts'
import { AsyncLock } from '../lock'
import * as Github from '../github/api'
import * as Slack from '../slack/api'
import * as Repos from '../repos'
import * as Channels from '../channels'
import { updateMessageReactions } from './reactions'
import { updateMessageReplies } from './replies'

const PR_LOCKS: Map<string, AsyncLock> = new Map()

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

export function getPullRequestRef({
  owner,
  repo,
  number,
}: {
  owner: string
  repo: string
  number: string
}) {
  return Repos.getRepoRef({ owner, repo }).collection('prs').doc(`${number}`)
}

export async function getPullRequestDocument(pr: PullRequestIdentifier) {
  const ref = getPullRequestRef(pr)

  const prSnap = await ref.get()

  return prSnap.data() as PullRequestDocument
}

export async function addPullRequestFromEventMessage(message: SlackMessage) {
  if (message.thread_ts != null) {
    return
  }

  const match = Slack.matchPullRequestURL(message?.text)

  if (!match) {
    return
  }

  const [, owner, repo, number] = match

  const repoRef = Repos.getRepoRef({ owner, repo })
  const repoSnap = await repoRef.get()

  if (!repoSnap.exists) {
    await repoRef.set({
      owner,
      repo,
      installationId: null,
    })
  }

  const prRef = getPullRequestRef({ owner, repo, number })
  const prSnap = await prRef.get()

  const messageRef = Channels.getChannelMessageRef({
    channelId: message.channel,
    ts: message.ts,
  })

  await messageRef.set({
    done: false,
    channel: message.channel,
    ts: message.ts,
    poster_id: message.user,
    prRef,
    replies: {},
    reactions: {},
  })

  if (prSnap.exists) {
    const pr = prSnap.data() as PullRequestDocument

    pr.messageRefs.push(messageRef)

    return updateAndEvaluate(pr)
  }

  return updateAndEvaluate({
    owner,
    repo,
    number,
    messageRefs: [messageRef],
  } as PullRequestDocument)
}

export async function updateAndEvaluate(pr: PullRequestDocument) {
  const remoteState = await getPullRequestConsolidatedState(pr)

  const newPr = {
    ...pr,
    ...remoteState,
  } as PullRequestDocument

  await getPullRequestRef(newPr).set(newPr)

  return evaluatePullRequest(newPr)
}

export async function evaluatePullRequest(pr: PullRequestDocument) {
  console.log(`Evaluating: "${getPullRequestID(pr)}"`)

  const id = getPullRequestID(pr)
  let lock = PR_LOCKS.get(id)

  if (!lock) {
    lock = new AsyncLock()
    PR_LOCKS.set(id, lock)
  }

  await lock.acquire()

  try {
    // update each possible message referencing the same pr
    // todo: can be made in parallalel
    for await (const rootMsgRef of pr.messageRefs) {
      const rootMsgSnap = await rootMsgRef.get()

      if (!rootMsgSnap.exists) {
        console.log(
          `Removing non-exising message reference from ${getPullRequestID(pr)}`
        )

        await getPullRequestRef(pr).update({
          messageRefs: firestore.FieldValue.arrayRemove(rootMsgRef),
        })

        continue
      }

      const rootMsgData = rootMsgSnap.data() as ChannelMessageDocument

      // eslint-disable-next-line no-loop-func
      const modifiedRootMsg = await produce(rootMsgData, async (draft) => {
        await Promise.all([
          updateMessageReplies(draft, pr),
          updateMessageReactions(draft, pr),
        ])
      })

      if (isDeepEqual(rootMsgData, modifiedRootMsg)) {
        continue
      }

      await rootMsgRef.update(modifiedRootMsg)
    }
  } catch (e) {
    console.error(e)
    throw e
  } finally {
    // if pr is done, mark its related messages as done
    const isDone = isResolved(pr)

    console.log('Pull request done')
    await Promise.all(
      pr.messageRefs.map(async (ref) => {
        ref.update({ done: isDone })
      })
    )

    if (lock) {
      await lock.release()

      if (lock.acquired) {
        PR_LOCKS.delete(id)
      }
    }

    console.log('Evaluation Done')
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

  if (error) {
    return { error }
  }

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

export function isUnreachable({ error }: PullRequestDocument) {
  return error?.status === 403 || error?.status === 404 || error?.status === 520
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
