# Pull Request Slack Bot

## TODO

- [ ] mensagem de deletar branch
- [ ] verificar changelog (?)
- [ ] marcar na thread quem tiver marcado como reviewer em pr listado ou marcar o dono do post se tiver com 2 approvals
- [x] ignorar mudanças em yarn.lock (?)
- [x] marcar check de approval
- [x] mandar mensagem de prs prontos pra serem mergeados em thread
- [x] nao listar prs draft
- [x] ao deletar mensagem do pr, deletar os replies do bot
- [x] marcar todo mundo que mandou os prs na thread de prs esquecidos
- [x] mensagem big pr
- [x] editar mensagens de pr esquecidos
- [x] editar mensagem pr
- [x] ignorar usuarios desativados do slack

## How does it work?

For now, the bot works by pooling the Github API in a 10 seconds interval between each check cycle. For each PR, it makes 3 requests: one for general PR data, one for review data and the last for files data.

## Features

> TODO

## Configuring

> TODO

## Developing

- `npm run dev` - Listen only to messages from the test channels defined on `consts.js`
- `npm run start` - Start the bot on production mode
