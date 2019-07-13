const Slack = require('./api/slack');

exports.send = async ({ text, channel, thread_ts, ...rest }) => {
  const response = await Slack.send_message(text, channel, thread_ts);

  if (!response.ok) throw new Error(response);

  const { ts } = response;

  return {
    ...rest,
    thread_ts,
    ts,
    channel,
    text,
  };
};

exports.update = async (message, { text, ...rest }) => {
  const response = await Slack.update_message(message, text);

  if (!response.ok) throw new Error(response);

  return {
    ...message,
    ...rest,
    text,
  };
};
