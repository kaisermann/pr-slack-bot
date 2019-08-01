require('dotenv/config');

const Slack = require('./api/slack.js');
const Github = require('./api/github.js');
const low = require('lowdb');
const FileSyncAdapter = require('lowdb/adapters/FileSync');
const db = low(new FileSyncAdapter('data.json'));

db.defaults({
  messages: {},
}).write();

const channel = 'C98FX9724'; //frontendguild

const convert_date_to_slack_ts = date => date.getTime() / 1000;
const convert_slack_ts_to_date = ts => new Date(parseFloat(ts, 10) * 1000);

const subtract_dates = (d1, d2) => {
  if (typeof d1 === 'string') d1 = new Date(d1);
  if (typeof d2 === 'string') d2 = new Date(d2);
  const diff = (d2.getTime() - d1.getTime()) / 1000 / 60;
  return Math.abs(Math.round(diff));
};

const PR_REGEX = /github\.com\/([\w-.]*)?\/([\w-.]*?)\/pull\/(\d+)/i;

(async function() {
  async function get_pr_messages() {
    for await (const month of [1, 2, 3]) {
      let list = [];
      const oldest_ts = convert_date_to_slack_ts(new Date(2019, month - 1, 1));
      const latest_ts = convert_date_to_slack_ts(new Date(2019, month, 1));

      let response;
      let cursor;
      console.log('getting messages');
      do {
        response = await Slack.web_client.conversations.history({
          cursor,
          limit: 100,
          oldest: oldest_ts,
          latest: latest_ts,
          channel,
        });
        list.push(
          ...response.messages
            .filter(message => message.text.match(PR_REGEX))
            .map(({ text, ts }) => {
              return {
                match: text.match(PR_REGEX),
                ts,
                date: convert_slack_ts_to_date(ts),
              };
            }),
        );

        cursor = response.response_metadata.next_cursor;
      } while (response.has_more);
      console.log('got messages');

      // list = list.slice(0, 1);

      console.log('getting pr state');
      list = await Promise.all(
        list.map(async (item, i) => {
          const data = (await Github.get_pr_data(
            item.match[1],
            item.match[2],
            item.match[3],
          )).data;

          if (!data) return false;

          const { merged_at, merged, closed_at } = data;

          console.log(`got ${i}/${list.length}`);
          item.closed_at = closed_at;
          item.merged_at = merged_at;
          item.merged = merged;
          return item;
        }),
      );
      list = list.filter(Boolean);
      console.log('gotpr state');

      db.get('messages')
        .set(month, list)
        .write();
    }
    console.log('done');
  }

  // await get_pr_messages();

  const months = db
    .get('messages')
    .entries()
    .value();
  // "date": "2019-07-15T16:42:21.090Z",
  // "closed_at": "2019-07-15T20:24:09Z",
  // "merged_at": "2019-07-15T20:24:09Z",
  // "merged": true

  const results = months
    .map(([month, list]) => {
      return list.reduce(
        (acc, pr) => {
          const is_merged = pr.merged;
          const is_closed = !is_merged && pr.closed_at;
          if (is_merged) acc.merged++;
          else if (is_closed) acc.closed++;
          else acc.open++;

          if (is_merged) {
            acc.times_to_merge.push(subtract_dates(pr.date, pr.merged_at));
          }

          if (is_closed) {
            acc.times_to_close.push(subtract_dates(pr.date, pr.closed_at));
          }

          return acc;
        },
        {
          month: new Date(2019, month - 1, 1).toLocaleString('pt-br', {
            year: 'numeric',
            month: 'long',
          }),
          merged: 0,
          closed: 0,
          open: 0,
          times_to_merge: [],
          times_to_close: [],
        },
      );
    })
    .map(result => {
      result.average_hours_to_merge =
        result.times_to_merge.reduce((acc, diff) => acc + diff, 0) /
        result.times_to_merge.length /
        60;
      result.average_hours_to_close =
        result.times_to_close.reduce((acc, diff) => acc + diff, 0) /
        result.times_to_close.length /
        60;
      result.quickest_to_merge_in_hours =
        Math.min(...result.times_to_merge) / 60;
      result.slowest_to_merge_in_hours = ~~(
        Math.max(...result.times_to_merge) / 60
      );

      delete result.times_to_merge;
      delete result.times_to_close;

      return result;
    });

  console.log(results);
})();
