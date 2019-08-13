const polka = require('polka');
const { urlencoded } = require('body-parser');

polka()
  .use(urlencoded({ extended: true }))
  .post('/command', async (req, res) => {
    const { text, channel_id, response_url, user_id } = req.body;
    const [command, ...params] = text.split(' ');

    if (!command) {
      res.end(
        [
          '*Available commands*:',
          '`pr list` - list all open prs on the channel',
          '`pr list mine` - list all of your PRs on the channel',
          '`pr list @user` - list all of a users PRs on the channel',
        ].join('\n'),
      );
      return;
    }

    const command_obj = {
      text,
      channel_id,
      response_url,
      user_id,
      command,
      params: params.join(' '),
    };
    let response;
    try {
      response = await require(`./commands/${command}.js`)(command_obj);
    } catch (e) {
      response = `No command \`${text}\``;
    }
    res.end(response);
  })
  .listen(12345, err => {
    if (err) throw err;
    console.log(`Server running on 12345`);
  });
