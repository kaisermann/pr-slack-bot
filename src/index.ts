import 'dotenv/config'

import express from 'express'
import { urlencoded, json } from 'body-parser'

import { handleGithubEvent } from './modules/github/events'
import { handleSlackEvent, handleSlackCommand } from './modules/slack/events'

const server = express()

server.use(urlencoded({ extended: true }))

server.use(json())

server.post('/slack/events', handleSlackEvent)

server.post('/slack/command', handleSlackCommand)

server.post('/github/events', handleGithubEvent)

server.post('/cron', handleGithubEvent)

server.listen(6006, (err) => {
  if (err) {
    throw err
  }
})
