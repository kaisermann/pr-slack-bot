const { basename } = require('path');
const R = require('ramda');
const is_equal = require('fast-deep-equal');

const Github = require('./api/github.js');
const Slack = require('./api/slack.js');
const Logger = require('./api/logger.js');
const DB = require('./api/db.js');
const Message = require('./message.js');
const Lock = require('./includes/lock.js');

const { EMOJIS, PR_SIZES } = require('./consts.js');

const ACTIONS = Object.freeze({
  approved: 'APPROVED',
  changes_requested: 'CHANGES_REQUESTED',
  pending_review: 'PENDING',
  review_requested: 'REVIEW_REQUESTED',
  commented: 'COMMENTED',
  merged: 'MERGED',
  unknown: 'UNKNOWN',
});

function get_action(action_list) {
  if (
    action_list.lastIndexOf(ACTIONS.changes_requested) >
    action_list.lastIndexOf(ACTIONS.approved)
  ) {
    return ACTIONS.changes_requested;
  }

  if (action_list.includes(ACTIONS.approved)) {
    return ACTIONS.approved;
  }

  if (action_list.includes(ACTIONS.pending_review)) {
    return ACTIONS.pending_review;
  }

  if (action_list.includes(ACTIONS.commented)) {
    return ACTIONS.commented;
  }
  return ACTIONS.unknown;
}

function get_action_label(action) {
  if (action === ACTIONS.approved)
    return { label: 'Approved', emoji: EMOJIS.approved };
  if (action === ACTIONS.changes_requested)
    return { label: 'Changes requested', emoji: EMOJIS.changes_requested };
  if (action === ACTIONS.pending_review)
    return { label: 'Is reviewing', emoji: EMOJIS.pending_review };
  if (action === ACTIONS.review_requested)
    return { label: 'Waiting review', emoji: EMOJIS.review_requested };
  if (action === ACTIONS.commented)
    return { label: 'Commented', emoji: EMOJIS.commented };
  if (action === ACTIONS.merged)
    return { label: 'Merged by', emoji: EMOJIS.merged };
  return { label: 'Unknown action', emoji: EMOJIS.unknown };
}

function get_pr_size({ additions, deletions, files }) {
  const lock_file_changes = files
    .filter(f => {
      const filename = basename(f.filename);
      return filename === 'package-lock.json' || filename === 'yarn.lock';
    })
    .reduce((acc, file) => acc + file.changes, 0);

  const n_changes = additions + deletions - lock_file_changes;

  let i;
  for (i = 0; i < PR_SIZES.length && n_changes > PR_SIZES[i][1]; i++);

  return {
    label: PR_SIZES[i][0],
    limit: PR_SIZES[i][1],
    n_changes,
    additions,
    deletions,
  };
}

function get_action_lists(pr_data, review_data) {
  return R.pipe(
    R.filter(
      ({ user, state: action }) =>
        action !== 'DISMISSED' ||
        pr_data.assignee == null ||
        user !== pr_data.assignee.login,
    ),
    R.groupBy(R.path(['user', 'login'])),
    R.toPairs,
    R.map(([user, actions]) => [user, actions.map(action => action.state)]),
  )(review_data);
}

exports.create = ({
  poster_id,
  slug,
  owner,
  repo,
  pr_id,
  channel,
  ts,
  state = {},
  replies = {},
  reactions = {},
}) => {
  let self;
  let _cached_remote_state = {};
  let _cached_url = null;
  const etag_signature = [owner, repo, pr_id];
  const update_lock = new Lock();

  function invalidate_etag_signature() {
    Github.invalidate_etag_signature(etag_signature);
  }

  async function get_message_url() {
    if (_cached_url == null) {
      _cached_url = await Slack.get_message_url(channel, ts);
    }
    return _cached_url;
  }

  function has_reply(id) {
    return id in replies;
  }

  async function delete_reply(id) {
    if (!has_reply(id)) return false;

    console.log(`- Deleting reply with id: ${id}`);

    return Message.delete(replies[id])
      .then(() => {
        delete replies[id];
        return true;
      })
      .catch(e => {
        if (e.data.error === 'message_not_found') {
          console.log(`- Tried to delete an already deleted message`);
          delete replies[id];
        }
        return false;
      });
  }

  async function delete_replies(reply_ids = Object.keys(replies)) {
    return Promise.all(reply_ids.map(delete_reply));
  }

  async function update_reply(id, updateFn, payload) {
    if (!has_reply(id)) return false;

    const saved_reply = replies[id];

    if (
      saved_reply.payload != null &&
      payload != null &&
      is_equal(saved_reply.payload, payload)
    )
      return false;

    const text = Message.build_text(updateFn(saved_reply));

    if (saved_reply.text === text) return false;

    if (text === '') {
      return delete_reply(id);
    }

    try {
      console.log(`- Updating reply: ${text}`);
      replies[id] = await Message.update(saved_reply, {
        text,
        payload,
      });
    } catch (e) {
      console.error(saved_reply.channel, saved_reply.ts, saved_reply.text, e);
    }
    return true;
  }

  async function reply(id, text_parts, payload) {
    if (has_reply(id)) {
      return update_reply(id, () => text_parts, payload);
    }

    const text = Message.build_text(text_parts);

    if (text === '') return false;

    console.log(`- Sending reply: ${text}`);
    return Message.send({
      text,
      channel,
      thread_ts: ts,
      payload,
    })
      .then(message => {
        replies[id] = message;
        return true;
      })
      .catch(e => {
        console.error(`Reply error`, text, channel, ts, e);
        return false;
      });
  }

  async function remove_reaction(type) {
    if (!(type in reactions)) {
      return false;
    }

    const name = reactions[type];

    console.log(`- Removing reaction of type: ${type} (${reactions[type]})`);
    Logger.add_call('slack.reactions.remove');

    return Slack.web_client.reactions
      .remove({ name, timestamp: ts, channel })
      .then(() => {
        delete reactions[type];
        return true;
      })
      .catch(e => {
        if (e.data.error === 'no_reaction') {
          delete reactions[type];
        }

        if (process.env.NODE_ENV !== 'production') {
          console.error(e);
        }
        return false;
      });
  }

  async function add_reaction(type, name) {
    if (type in reactions) {
      if (reactions[type] === name) return false;
      await remove_reaction(type);
    }

    console.log(`- Adding reaction of type: ${type} (${name})`);
    Logger.add_call('slack.reactions.add');

    return Slack.web_client.reactions
      .add({ name, timestamp: ts, channel })
      .then(() => {
        reactions[type] = name;
        return true;
      })
      .catch(e => {
        if (e.data.error === 'already_reacted') {
          reactions[type] = name;
        }

        if (process.env.NODE_ENV !== 'production') {
          console.error(e);
        }
        return false;
      });
  }

  async function fetch_remote_state() {
    const params = { owner, repo, pr_id, etag_signature };
    const [pr_response, review_response, files_response] = await Promise.all([
      Github.get_pr_data(params),
      Github.get_review_data(params),
      Github.get_files_data(params),
    ]);

    let pr_data = pr_response.data;
    let review_data = review_response.data;
    let files_data = files_response.data;

    // nothing changed, nothing to change
    if (
      pr_response.status === 304 &&
      review_response.status === 304 &&
      files_response.status === 304
    ) {
      return _cached_remote_state;
    }

    if (pr_response.status === 200) {
      _cached_remote_state.pr_data = pr_data;
    } else {
      pr_data = _cached_remote_state.pr_data;
    }

    if (review_response.status === 200) {
      _cached_remote_state.review_data = review_data;
    } else {
      review_data = _cached_remote_state.review_data;
    }

    if (files_response.status === 200) {
      _cached_remote_state.files_data = files_data;
    } else {
      files_data = _cached_remote_state.files_data;
    }

    if (pr_data == null || review_data == null || files_data == null) {
      console.error(
        pr_response.status,
        review_response.status,
        files_response.status,
      );
      console.error(!!pr_data, !!review_data, !!files_data);
      throw new Error(`Something went wrong with ${slug} github requests.`);
    }

    return { pr_data, review_data, files_data };
  }

  async function get_consolidated_state() {
    const { pr_data, review_data, files_data } = await fetch_remote_state();

    // review data mantains a list of reviews
    const action_lists = get_action_lists(pr_data, review_data);

    const actions = []
      .concat(
        pr_data.requested_reviewers.map(({ login }) => {
          return {
            github_user: login,
            action: ACTIONS.review_requested,
          };
        }),
      )
      .concat(
        action_lists.map(([github_user, action_list]) => {
          return {
            github_user,
            action: get_action(action_list),
          };
        }),
      )
      .concat(
        pr_data.merged_by != null
          ? [{ github_user: pr_data.merged_by.login, action: ACTIONS.merged }]
          : [],
      )
      .map(({ github_user, action }) => {
        const user = DB.get_user_by_github_user(github_user);
        if (user) {
          return { ...user, action };
        }
        return { github_user, action };
      });

    const { additions, deletions } = pr_data;

    return {
      actions,
      additions,
      deletions,
      files: files_data,
      size: get_pr_size({ additions, deletions, files: files_data }),
      merged: pr_data.merged,
      closed: pr_data.state === 'closed',
      mergeable_state: pr_data.mergeable_state,
      head_branch: pr_data.head.ref,
      base_branch: pr_data.base.ref,
    };
  }

  function has_changelog() {
    return state.files.some(f => {
      const filename = basename(f.filename).toLowerCase();

      return (
        filename === 'changelog.md' &&
        (f.status === 'modified' || f.status === 'added')
      );
    });
  }

  function has_changes_requested() {
    return state.actions.some(
      item => item.action === ACTIONS.changes_requested,
    );
  }

  function has_pending_review() {
    return state.actions.some(item => item.action === ACTIONS.pending_review);
  }

  function is_draft() {
    return state.mergeable_state === 'draft';
  }

  function is_ready_to_merge() {
    return !state.closed && state.mergeable_state === 'clean';
  }

  function is_dirty() {
    return state.mergeable_state === 'dirty';
  }

  function is_unstable() {
    return state.mergeable_state === 'unstable';
  }

  function is_resolved() {
    return state.closed || state.merged;
  }

  function is_active() {
    return !is_draft();
  }

  async function update_header_message() {
    const { actions, size } = state;

    const text_parts = [
      () => {
        return `:${EMOJIS[`size_${size.label}`]}: *PR size*: ${size.label} (_${
          size.n_changes
        } changes_)\n\n`;
      },
      actions.length === 0
        ? `Waiting for reviewers :${EMOJIS.waiting}:`
        : () => {
            const header_text = Object.entries(
              actions.reduce((acc, { id, github_user, action }) => {
                if (!(action in acc)) acc[action] = [];

                const mention = id ? `<@${id}>` : github_user;
                acc[action].push(mention);
                return acc;
              }, {}),
            )
              .map(([action, mentions]) => {
                const { label, emoji } = get_action_label(action);
                return `:${emoji}: *${label}*: ${mentions.join(', ')}`;
              })
              .join('\n\n');

            return header_text;
          },
    ];

    return reply('header_message', text_parts, { size, actions });
  }

  async function update_reactions() {
    const { size, merged, closed } = state;

    const changes = {};

    changes.size = await add_reaction('size', EMOJIS[`size_${size.label}`]);

    changes.ready_to_merge = is_ready_to_merge()
      ? await add_reaction('approved', EMOJIS.approved)
      : await remove_reaction('approved');

    changes.changes_requested = has_changes_requested()
      ? await add_reaction('changes_requested', EMOJIS.changes_requested)
      : await remove_reaction('changes_requested');

    changes.has_pending_review = has_pending_review()
      ? await add_reaction('pending_review', EMOJIS.pending_review)
      : await remove_reaction('pending_review');

    changes.unstable_or_dirty =
      is_unstable() || is_dirty()
        ? await add_reaction('unstable_or_dirty', EMOJIS.unstable_or_dirty)
        : await remove_reaction('unstable_or_dirty');

    changes.merged = merged
      ? await add_reaction('merged', EMOJIS.merged)
      : await remove_reaction('merged');

    changes.closed = closed
      ? await add_reaction('closed', EMOJIS.closed)
      : await remove_reaction('closed');

    return changes;
  }

  async function update_replies() {
    const { head_branch, base_branch } = state;

    const changes = {
      header_message: await update_header_message(),
    };

    changes.dirty = is_dirty()
      ? await reply(
          'is_dirty',
          `The branch \`${head_branch}\` is dirty. It may need a rebase with \`${base_branch}\`.`,
        )
      : await delete_reply('is_dirty');

    changes.modified_changelog =
      has_changelog() === false
        ? await reply(
            'modified_changelog',
            `I couln't find an addition to the \`CHANGELOG.md\`.\n\nDid you forget to add it :notsure:?`,
          )
        : await delete_reply('modified_changelog');

    changes.ready_to_merge = is_ready_to_merge()
      ? await reply('ready_to_merge', 'PR is ready to be merged :doit:!')
      : await delete_reply('ready_to_merge');

    return changes;
  }

  async function update() {
    await update_lock.acquire();
    console.log(`Getting consolidated state: ${slug}`);
    state = await get_consolidated_state();

    return after_state_update();
  }

  // we always update the consolidated state for making things easier :)
  async function update_on_hook({ event, action }) {
    await update_lock.acquire();
    if (event === 'pull_request') {
      if (action === 'reopened') {
        state.closed = false;
      } else if (action === 'closed') {
        state.closed = true;
      } else {
        state = await get_consolidated_state();
      }
    } else {
      state = await get_consolidated_state();
    }

    return after_state_update();
  }

  async function after_state_update() {
    await Promise.all([update_reactions(), update_replies()]);
    update_lock.release();

    return self;
  }

  function to_json() {
    return {
      poster_id,
      slug,
      owner,
      repo,
      pr_id,
      channel,
      ts,
      replies,
      reactions,
      state,
    };
  }

  self = Object.freeze({
    // props
    poster_id,
    slug,
    owner,
    repo,
    pr_id,
    channel,
    ts,
    get state() {
      return state;
    },
    get minutes_since_post() {
      return Math.abs(new Date(ts * 1000) - new Date()) / (1000 * 60);
    },
    get hours_since_post() {
      return ~~(this.minutes_since_post / 60);
    },
    // methods
    update,
    get_message_url,
    async get_message_link(fn) {
      return `<${[await get_message_url()]}|${fn(self)}>`;
    },
    reply,
    update_reply,
    delete_reply,
    delete_replies,
    has_changes_requested,
    is_draft,
    is_ready_to_merge,
    is_dirty,
    is_unstable,
    is_resolved,
    invalidate_etag_signature,
    to_json,
    is_active,
    needs_attention(hours) {
      return is_active() && this.minutes_since_post >= 60 * hours;
    },
    update_on_hook,
  });

  return self;
};
