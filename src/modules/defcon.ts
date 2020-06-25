import fetch from 'node-fetch'
import memoize from 'memoizee'

const DEFCON_ENDPOINT = `http://monitoring.vtex.com/api/pvt/defcon`

async function fetchDefconStatus() {
  try {
    const response = await fetch(DEFCON_ENDPOINT, {
      headers: {
        'x-vtex-api-appkey': process.env.VTEX_APP_KEY,
        'x-vtex-api-apptoken': process.env.VTEX_APP_TOKEN,
      },
    })

    const { level, message } = await response.json()
    const [, id, msg] = message.match(/DEFCON (\d)\s*-\s*(.*)/i)

    return {
      level,
      message: msg,
      id,
    }
  } catch (e) {
    // console.error(e, 'DEFCON request');
    return null
  }
}

export const getDefconStatus = memoize(fetchDefconStatus, {
  maxAge: 1000 * 60 * 30,
  preFetch: true,
})
