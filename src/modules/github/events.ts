import express from 'express'

import { db } from '../../firebase'
import * as PR from '../pr/pr'

function onInstallation(req) {
  const {
    installation,
    repositories_removed: removed,
    repositories_added: added,
  } = req.body

  if (removed) {
    removed.forEach(({ full_name: fullName }) => {
      const repoId = fullName.replace('/', '@')

      db.collection('github_installations').doc(repoId).delete()
    })
  }

  if (added) {
    added.forEach(({ full_name: fullName }) => {
      const repoId = fullName.replace('/', '@')

      console.log(repoId)

      db.collection('github_installations')
        .doc(repoId)
        .set({ installationId: installation.id })
    })

    // todo: is this needed?
    // const added_set = new Set(added.map((repo) => repo.full_name))
    // const relevantPrs = db.collection('prs').where('owner', 'in', added_set)
    // return update_prs(relevantPrs)
  }
}

async function onPullRequestChange({ event, req }) {
  const { action, repository } = req.body
  let { pull_request: pullRequest } = req.body

  if (event === 'check_suite') {
    pullRequest = req.body.check_suite.pull_requests[0]
  }

  if (!pullRequest) {
    console.warn(`Couldn't find pull request for "${event}/${action}"`)

    return
  }

  const prId = `${repository.owner}@${repository.repo}@${pullRequest.number}`

  console.log(`Triggered "${event}/${action}" on "${prId}"`)

  const prSnap = await db.collection('prs').doc(prId).get()

  if (!prSnap.exists) {
    console.log(`PR not found "${prId}"`)

    return
  }

  const prDoc = prSnap.data() as PullRequestDocument

  return PR.evaluatePullRequest(prDoc)
}

async function onBranchPush({ req }) {
  const { ref, repository } = req.body
  const branch = ref.split('/').pop()

  const relatedPRs = await db
    .collection('prs')
    .where('repo', '==', repository.name)
    .where('owner', '==', repository.owner.name)
    .where('base_branch', '==', branch)
    .get()

  if (!relatedPRs.empty) {
    console.log(
      `Triggered "push" on "${repository.owner.name}/${
        repository.name
      }": ${relatedPRs.docs.map((prDoc) => prDoc.id).join(', ')}`
    )
  }

  return PR.evaluatePullRequests(
    relatedPRs.docs.map((doc) => doc.data() as PullRequestDocument)
  )
}

export async function handleGithubEvent(
  req: express.Request,
  res: express.Response
) {
  const event = req.headers['x-github-event']
  const { action } = req.body

  res.send('ok')

  if (event === 'installation_repositories') {
    return onInstallation(req)
  }

  if (
    event === 'pull_request' ||
    event === 'pull_request_review' ||
    event === 'pull_request_review_comment' ||
    event === 'check_suite'
  ) {
    return onPullRequestChange({ event, req })
  }

  if (event === 'push') {
    return onBranchPush({ req })
  }

  console.warn(`[GITHUB] Ignoring event: "${event}/${action}"`)
}
