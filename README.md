# Pull Request Slack Bot

## TODO

- [ ] update readme
- [ ] separate prs ƒrom channels to it's possible to have a pr in multiple channels

## How does it work?

> TODO: Update

For now, the bot works by pooling the Github API in a 10 seconds interval between each check cycle. For each PR, it makes 3 requests: one for general PR data, one for review data and the last for files data.

## Features

> TODO

## Configuring

> TODO

## Developing

- `npm run dev` - Listen only to messages from the test channels defined on `consts.js`
- `npm run start` - Start the bot on production mode
