import express from 'express'

import { db } from '../../firebase'
import * as PR from '../pr/pr'
import * as Repos from '../repos'

function onInstallation(req) {
  const {
    installation,
    repositories_removed: removed,
    repositories_added: added,
  } = req.body

  if (removed) {
    removed.forEach(({ full_name: fullName }) => {
      const repoId = fullName.replace('/', '@')

      db.collection('repos').doc(repoId).update({ installationId: null })
    })
  }

  if (added) {
    added.forEach(({ full_name: fullName }) => {
      const repoId = fullName.replace('/', '@')

      console.log(repoId)

      db.collection('repos')
        .doc(repoId)
        .update({ installationId: installation.id })
    })

    // todo: is this really needed?
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

  const [owner, repo] = repository.full_name.split('/')
  const prIdentifier = { owner, repo, number: pullRequest.number }

  console.log(
    `Triggered "${event}/${action}" on "${PR.getPullRequestID(prIdentifier)}"`
  )

  const prDoc = await PR.getPullRequestDocument(prIdentifier)

  if (prDoc == null) {
    console.log(`PR not found "${PR.getPullRequestID(prIdentifier)}"`)

    return
  }

  return PR.updateAndEvaluate(prDoc)
}

async function onBranchPush({ req }) {
  const { ref, repository } = req.body
  const branch = ref.split('/').pop()

  const relatedPRs = await Repos.getRepoPullRequestCollection({
    owner: repository.owner.name,
    repo: repository.name,
  })
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
