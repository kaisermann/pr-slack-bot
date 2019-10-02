const send = require('@polka/send-type');

const runtime = require('../runtime.js');
const roulette = require(`./commands/roulette.js`);

exports.parse_slack_event = async (req, res) => {
  const {
    type: request_type,
    authed_users: [bot_id],
  } = req.body;
  if (request_type === 'url_verification') {
    const { challenge } = req.body;
    return send(res, 200, challenge);
  }
  if (request_type === 'event_callback') {
    const { event } = req.body;
    if (event.type === 'app_mention') {
      const { ts, thread_ts, channel: channel_id, text } = event;
      const channel = runtime.get_channel(channel_id);
      if (!channel || !thread_ts) return;
      const normalized_text = text.replace(`<@${bot_id}>`, '').trim();
      if (normalized_text.match(/roulette|random|potato|choose/)) {
        return roulette({ channel, ts, thread_ts });
      }
    }
  }
  console.log(request_type, req.body);
  // send(res, 200, response_data);
};
