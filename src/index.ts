import 'dotenv/config'

import send from '@polka/send-type'
import polka from 'polka'
import { urlencoded, json } from 'body-parser'

import { updateUser, updateUserGroup } from './modules/users'
import {
  isPullRequestMessage,
  addPullRequestFromEventMessage,
} from './modules/pr/pr'

async function handleEvent(req: any, res: any) {
  const { type } = req.body

  console.log(`Slack event "${type}"`)

  if (type === 'url_verification') {
    const { challenge } = req.body

    return send(res, 200, challenge)
  }

  const { type: eventType } = req.body.event

  console.log(`Slack event type "${eventType}"`)

  console.log(req.headers)
  console.log(req.body.event)

  if (eventType === 'user_change') {
    const { user } = req.body.event

    send(res, 200, { ok: true })
    await updateUser(user.id, user)

    return
  }

  if (eventType === 'subteam_updated') {
    const { subteam: group } = req.body.event

    send(res, 200, { ok: true })
    await updateUserGroup(group.id, group)

    return
  }

  if (eventType === 'message') {
    const { event: message } = req.body

    if (isPullRequestMessage(message)) {
      await addPullRequestFromEventMessage(message)
    }

    send(res, 200, { ok: true })

    return
  }

  console.log(JSON.stringify(req.body, null, 2))

  return send(res, 200, { ok: true })
}

const server = polka()

server.use(urlencoded({ extended: true }))
server.use(json())
server.post('/slack/events', handleEvent)

server.listen(6006, (err) => {
  if (err) throw err
})
