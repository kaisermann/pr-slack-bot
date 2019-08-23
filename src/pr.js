const { basename } = require('path');
const R = require('ramda');
const is_equal = require('fast-deep-equal');

const Github = require('./api/github.js');
const Slack = require('./api/slack.js');
const Logger = require('./includes/logger.js');
const DB = require('./api/db.js');
const Message = require('./message.js');
const Lock = require('./includes/lock.js');
const debounce = require('./includes/debounce.js');

const { EMOJIS, PR_SIZES, GITHUB_APP_URL } = require('./consts.js');

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
    .reduce((acc, file) => acc + file.additions + file.deletions, 0);

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

    Logger.info(`- Deleting reply with id: ${id}`);

    return Message.delete(replies[id])
      .then(() => {
        delete replies[id];
        return true;
      })
      .catch(e => {
        if (e.data.error === 'message_not_found') {
          Logger.info(`- Tried to delete an already deleted message`);
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
      Logger.info(`- Updating reply: ${text}`);
      replies[id] = await Message.update(saved_reply, {
        text,
        payload,
      });
    } catch (e) {
      Logger.error(e);
    }
    return true;
  }

  async function reply(id, text_parts, payload) {
    if (has_reply(id)) {
      return update_reply(id, () => text_parts, payload);
    }

    const text = Message.build_text(text_parts);

    if (text === '') return false;

    Logger.info(`- Sending reply: ${text}`);
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
        Logger.error(e);
        return false;
      });
  }

  async function remove_reaction(type) {
    if (!(type in reactions)) {
      return false;
    }
    const name = reactions[type];

    Logger.info(`- Removing reaction of type: ${type} (${reactions[type]})`);
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
        Logger.error(e);
        return false;
      });
  }

  async function add_reaction(type, name) {
    if (type in reactions) {
      if (reactions[type] === name) return false;
      await remove_reaction(type);
    }

    Logger.info(`- Adding reaction of type: ${type} (${name})`);
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
        Logger.error(e);
        return false;
      });
  }

  async function fetch_remote_state() {
    const params = { owner, repo, pr_id, etag_signature };

    const responses = await Promise.all([
      // we make a promise that only resolves when a PR mergeability is known
      new Promise(async res => {
        try {
          let known_mergeable_state = false;
          let data;
          let status;
          do {
            const response = await Github.get_pr_data(params);
            data = response.data;
            status = response.status;

            if (status === 200 || status === 304) {
              if (status === 304) {
                data = _cached_remote_state.pr_data;
              } else {
                _cached_remote_state.pr_data = data;
              }

              known_mergeable_state = data.merged || data.mergeable != null;
            } else if (status === 502) {
              known_mergeable_state = false;
            }

            if (known_mergeable_state === false) {
              Logger.warn(
                `[${status}] Unknown mergeable state for ${slug}. Retrying...`,
              );
              await new Promise(r => setTimeout(r, 500));
            }
          } while (known_mergeable_state === false);

          res({ status, data });
        } catch (e) {
          Logger.error(e);
          res({ status: 520 });
        }
      }),
      Github.get_review_data(params),
      Github.get_files_data(params),
    ]);

    if (responses.some(response => response.status === 520)) {
      return {
        error: { status: 520 },
      };
    }

    const [pr_response, review_response, files_response] = responses;

    if (
      pr_response.status === 404 ||
      review_response.status === 404 ||
      files_response.status === 404
    ) {
      return {
        error: { status: 404 },
      };
    }

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
      Logger.log(
        pr_response.status,
        review_response.status,
        files_response.status,
      );
      Logger.log(!!pr_data, !!review_data, !!files_data);
      throw new Error(`Something went wrong with ${slug} github requests.`);
    }

    return { pr_data, review_data, files_data };
  }

  async function get_consolidated_state() {
    const {
      error,
      pr_data,
      review_data,
      files_data,
    } = await fetch_remote_state();

    if (error) {
      return {
        error,
      };
    }

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
        const user = DB.users.get_by_github_user(github_user);
        if (user) {
          return { ...user, action };
        }
        return { github_user, action };
      });

    const { title, additions, deletions, mergeable } = pr_data;
    const files = files_data.map(
      ({ filename, status, additions, deletions }) => {
        return { filename, status, additions, deletions };
      },
    );

    return {
      title,
      actions,
      additions,
      deletions,
      files,
      size: get_pr_size({ additions, deletions, files }),
      mergeable,
      merged: pr_data.merged,
      closed: pr_data.state === 'closed',
      mergeable_state: pr_data.mergeable_state,
      head_branch: pr_data.head.ref,
      base_branch: pr_data.base.ref,
    };
  }

  function get_approvals() {
    return state.actions.filter(a => a.action === ACTIONS.approved).length;
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
    const { actions, size, title } = state;

    const text_parts = [
      `:${EMOJIS.info}: *Title*: ${title}\n\n`,
      `:${EMOJIS[`size_${size.label}`]}: *PR size*: ${size.label} (_${
        size.n_changes
      } changes_)\n\n`,
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

    return reply('header_message', text_parts, { title, size, actions });
  }

  async function update_reactions() {
    const { error, size, merged, closed } = state;

    if (error) return;

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

    changes.closed =
      closed && !merged
        ? await add_reaction('closed', EMOJIS.closed)
        : await remove_reaction('closed');

    return changes;
  }

  async function update_replies() {
    const { error, head_branch, base_branch } = state;

    const changes = {};
    if (error) {
      if (error.status === 404) {
        changes.error = await reply(
          'error',
          `Sorry, but I think my <${GITHUB_APP_URL}|Github App> is not installed on this repository :thinking_face:. I should be able to watch this PR after the app is installed •ᴥ•`,
        );
      } else if (error.status === 520) {
        changes.error = await reply(
          'error',
          `Sorry, but something awful happened :scream:. I can't see this PR status...`,
        );
      }
      return changes;
    } else {
      changes.error = await delete_reply('error');
    }

    changes.header_message = await update_header_message();

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

    if (is_ready_to_merge() === false) {
      changes.ready_to_merge = await delete_reply('ready_to_merge');
    } else {
      const n_approvals = get_approvals();
      const text =
        n_approvals > 0
          ? 'PR is ready to be merged :doit:!'
          : `PR is ready to be merged, but I can't seem to find any reviews approving it :notsure-left:.\n\nIs there a merge protection rule configured for the \`${base_branch}\` branch?`;
      changes.ready_to_merge = await reply('ready_to_merge', text);
    }

    return changes;
  }

  async function update() {
    try {
      await update_lock.acquire();
      state = await get_consolidated_state();
      Logger.info(`Updated state: ${slug}`);
      await Promise.all([update_reactions(), update_replies()]);
    } catch (e) {
      Logger.error(e, `Something went wrong with "${slug}":`);
    } finally {
      update_lock.release();
    }

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
    // we debounce the update method so many consecutive updates fire just once
    update: debounce(update, 400),
    get_message_url,
    get_message_link: async fn => `<${[await get_message_url()]}|${fn(self)}>`,
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
    is_active,
    needs_attention(hours) {
      return is_active() && this.minutes_since_post >= 60 * hours;
    },
    invalidate_etag_signature,
    to_json,
  });

  return self;
};
