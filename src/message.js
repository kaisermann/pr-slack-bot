const { produce } = require('immer');
const Slack = require('./api/slack.js');

exports.send = async ({ text, blocks, channel, thread_ts, ...rest }) => {
  const response = await Slack.send_message({
    text,
    blocks,
    channel,
    thread_ts,
  });

  if (!response.ok) throw response;

  const { ts } = response;
  return {
    ...rest,
    thread_ts,
    ts,
    channel,
    blocks,
    text,
  };
};

exports.update = async (message, fn) => {
  const updated_message = produce(message, fn);

  const response = await Slack.update_message(updated_message);

  if (!response.ok) throw new Error(response);

  return updated_message;
};

exports.delete = async message => {
  const response = await Slack.delete_message(message);

  if (!response.ok) throw new Error(response);

  return true;
};

exports.build_text = parts => {
  parts = Array.isArray(parts) ? parts : [parts];
  return parts
    .filter(Boolean)
    .map(part => (typeof part === 'function' ? part() : part))
    .join('');
};

exports.blocks = {
  create_markdown_section: text => ({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: exports.build_text(text),
    },
  }),
};
