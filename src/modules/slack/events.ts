import express from 'express'

import { updateUser, updateUserGroup } from '../users'
import * as PR from '../pr/pr'
import { sendRoulette } from './roulette'
import * as Slack from './api'

export async function handleSlackEvent(
  req: express.Request,
  res: express.Response
) {
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
      sendRoulette({
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

    if (Slack.matchPullRequestURL(message?.text)) {
      await PR.addPullRequestFromEventMessage(message)
    }

    return
  }

  console.log(req.headers)
  console.log(req.body.event)

  return res.json({ ok: true })
}

export async function handleSlackCommand(
  req: express.Request,
  res: express.Response
) {
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
    const commandMod = await import(`./commands/${command}`)

    responseData = await commandMod.default(commandObj)

    if (typeof responseData !== 'string') {
      responseData = {
        blocks: responseData,
      }
    }
  } catch (e) {
    responseData = `No command \`${text}\`. Please type \`/pr help\` to see available commands.`
    console.error(e, 'Slack command response')
  }

  res.send(responseData)
}
