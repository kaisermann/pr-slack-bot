import 'dotenv/config'

import send from '@polka/send-type'
import polka from 'polka'
import { urlencoded, json } from 'body-parser'

import { updateUser, updateUserGroup } from './modules/users'
import {
  isPullRequestMessage,
  addPullRequestFromEventMessage,
} from './modules/pr'

async function handleEvent(req: any, res: any) {
  const { type } = req.body

  if (type === 'url_verification') {
    const { challenge } = req.body

    return send(res, 200, challenge)
  }

  const { type: eventType } = req.body.event

  if (eventType === 'user_change') {
    const { user } = req.body.event

    await updateUser(user.id, user)

    return send(res, 200)
  }

  if (eventType === 'subteam_updated') {
    const { subteam: group } = req.body.event

    await updateUserGroup(group.id, group)

    return send(res, 200)
  }

  if (eventType === 'link_shared') {
    const { event: message } = req.body

    console.log(isPullRequestMessage(message))

    if (isPullRequestMessage(message)) {
      await addPullRequestFromEventMessage(message)
    }

    return send(res, 200)
  }

  console.log(JSON.stringify(req.body, null, 2))

  return send(res, 200)
}

const server = polka()

server.use(urlencoded({ extended: true }))
server.use(json())
server.post('/slack/events', handleEvent)

server.listen(6006, err => {
  if (err) throw err
})
