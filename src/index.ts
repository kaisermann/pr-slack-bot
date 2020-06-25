import 'dotenv/config'

import express from 'express'
import { urlencoded, json } from 'body-parser'

import { updateUser, updateUserGroup } from './modules/users'
import * as PR from './modules/pr/pr'
import * as Slack from './modules/slack/roulette'
import { db } from './firebase'

async function handleSlackEvent(req: express.Request, res: express.Response) {
  const { type } = req.body

  if (type === 'url_verification') {
    const { challenge } = req.body

    return res.send(challenge)
  }

  const { type: eventType } = req.body.event

  console.log(`Slack event type "${eventType}"`)

  if (eventType === 'user_change') {
    const { user } = req.body.event

    res.json({ ok: true })
    await updateUser(user.id, user)

    return
  }

  if (eventType === 'subteam_updated') {
    const { subteam: group } = req.body.event

    res.json({ ok: true })
    await updateUserGroup(group.id, group)

    return
  }

  if (eventType === 'app_mention') {
    const {
      ts,
      thread_ts: threadTs,
      channel: channelId,
      user: userId,
      text,
    } = req.body.event

    if (!threadTs) return

    const match = text.match(/(?:roulette|random)(?: +(.*)$)?/)

    if (match) {
      Slack.sendRoulette({
        channel_id: channelId,
        ts,
        thread_ts: threadTs,
        user_id: userId,
        params: match?.[1],
      })
    }
  }

  if (eventType === 'message') {
    const { event: message } = req.body

    res.json({ ok: true })

    if (PR.isPullRequestMessage(message)) {
      await PR.addPullRequestFromEventMessage(message)
    }

    return
  }

  console.log(req.headers)
  console.log(req.body.event)

  return res.json({ ok: true })
}

async function handleSlackCommand(req: express.Request, res: express.Response) {
  const { text, channel_id, response_url, user_id } = req.body
  const [command, ...params] = text.split(' ')

  if (!command) {
    res.end('Please type `/pr help` to see available commands')

    return
  }

  const commandObj = {
    text,
    channel_id,
    response_url,
    user_id,
    command,
    params: params.join(' '),
  }

  let responseData

  try {
    responseData = (
      await import(`./modules/slack/commands/${command}`)
    ).default(commandObj)
    if (typeof responseData !== 'string') {
      responseData = {
        blocks: responseData,
      }
    }
  } catch (e) {
    responseData = `No command \`${text}\`.\n\nPlease type \`/pr help\` to see available commands.`
    console.error(e, 'Slack command response')
  }

  res.json(responseData)
}

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

async function handleGithubEvent(req: express.Request, res: express.Response) {
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

const server = express()

server.use(urlencoded({ extended: true }))
server.use(json())
server.post('/slack/events', handleSlackEvent)
server.post('/slack/command', handleSlackCommand)
server.post('/github/events', handleGithubEvent)

server.listen(6006, (err) => {
  if (err) throw err
})
