const fetch = require('node-fetch');
const memoize = require('memoizee');

const Logger = require('./logger.js');

const DEFCON_ENDPOINT = `http://monitoring.vtex.com/api/pvt/defcon`;

module.exports = memoize(
  async () => {
    try {
      const response = await fetch(DEFCON_ENDPOINT, {
        headers: {
          'x-vtex-api-appkey': process.env.VTEX_APP_KEY,
          'x-vtex-api-apptoken': process.env.VTEX_APP_TOKEN,
        },
      });
      const { level, message } = await response.json();
      const [, id, msg] = message.match(/DEFCON (\d)\s*-\s*(.*)/i);
      return {
        level,
        message: msg,
        id,
      };
    } catch (e) {
      Logger.error(e, 'DEFCON request');
      return null;
    }
  },
  { maxAge: 1000 * 60 * 30, preFetch: true },
);
