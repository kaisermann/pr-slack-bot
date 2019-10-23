const send = require('@polka/send-type');

const Logger = require('../includes/logger.js');

exports.parse_slack_command = async (req, res) => {
  const { text, channel_id, response_url, user_id } = req.body;
  const [command, ...params] = text.split(' ');

  if (!command) {
    res.end('Please type `/pr help` to see available commands');
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
    response_data = `No command \`${text}\`.\n\nPlease type \`/pr help\` to see available commands.`;
    Logger.error(e, 'Slack command response');
  }

  send(res, 200, response_data);
};
