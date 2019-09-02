const send = require('@polka/send-type');

exports.parse_slack_command = async (req, res) => {
  const { text, channel_id, response_url, user_id } = req.body;
  const [command, ...params] = text.split(' ');

  if (!command) {
    res.end(
      [
        '*Available commands*:',
        '`/pr list` - list all open prs on the channel',
        '`/pr list mine` - list all of your PRs on the channel',
        '`/pr list @user` - list all of a users PRs on the channel',
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
  let response_data;
  try {
    response_data = await require(`./commands/${command}.js`)(command_obj);
    if (typeof response_data !== 'string') {
      response_data = {
        blocks: response_data,
      };
    }
  } catch (e) {
    response_data = `No command \`${text}\``;
  }

  send(res, 200, response_data);
};
