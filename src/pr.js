const { basename } = require('path');
const R = require('ramda');
const is_equal = require('fast-deep-equal');

const Github = require('./api/github.js');
const Slack = require('./api/slack.js');
const Logger = require('./includes/logger.js');
const DB = require('./api/db.js');
const Message = require('./includes/message.js');
const Lock = require('./includes/lock.js');
const debounce = require('./includes/debounce.js');
const check_defcon = require('./includes/check_defcon.js');

const { EMOJIS, PR_SIZES, GITHUB_APP_URL } = require('./consts.js');

const ACTIONS = Object.freeze({
  approved: 'APPROVED',
  dismissed: 'DISMISSED',
  changes_requested: 'CHANGES_REQUESTED',
  pending_review: 'PENDING',
  review_requested: 'REVIEW_REQUESTED',
  commented: 'COMMENTED',
  merged: 'MERGED',
  unknown: 'UNKNOWN',
});

function get_action(action_list) {
  const last_approved_idx = action_list.lastIndexOf(ACTIONS.approved);
  const last_change_request_idx = action_list.lastIndexOf(
    ACTIONS.changes_requested,
  );

  if (last_change_request_idx > last_approved_idx) {
    return ACTIONS.changes_requested;
  }

  const last_dismissed_idx = action_list.lastIndexOf(ACTIONS.dismissed);
  if (last_dismissed_idx < last_approved_idx) {
    return ACTIONS.approved;
  }

  if (last_dismissed_idx >= 0) {
    return ACTIONS.dismissed;
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
  if (action === ACTIONS.approved) {
    return { label: 'Approved', emoji: EMOJIS.approved };
  }

  if (action === ACTIONS.changes_requested) {
    return { label: 'Changes requested', emoji: EMOJIS.changes_requested };
  }

  if (action === ACTIONS.pending_review) {
    return { label: 'Is reviewing', emoji: EMOJIS.pending_review };
  }

  if (action === ACTIONS.review_requested) {
    return { label: 'Waiting review', emoji: EMOJIS.waiting };
  }

  if (action === ACTIONS.dismissed) {
    return { label: 'Outdated review', emoji: EMOJIS.waiting };
  }

  if (action === ACTIONS.commented) {
    return { label: 'Commented', emoji: EMOJIS.commented };
  }

  if (action === ACTIONS.merged) {
    return { label: 'Merged by', emoji: EMOJIS.merged };
  }

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
      ({ user }) => pr_data.assignee == null || user !== pr_data.assignee.login,
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
  const etag_signature = [channel, owner, repo, pr_id];
  const update_lock = new Lock();

  function invalidate_etag_signature() {
    Github.invalidate_etag_signature(etag_signature);
  }

  async function get_message_url() {
    if (_cached_url == null) {
      _cached_url = await Slack.get_message_url(channel, ts);

      if (has_reply('header_message')) {
        const { thread_ts, ts } = replies.header_message;
        _cached_url = _cached_url.replace(
          /\/p\d*?$/,
          `/p${ts * 1000000}?thread_ts=${thread_ts}`,
        );
      }
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
        if (e.data && e.data.error === 'message_not_found') {
          Logger.info(`- Tried to delete an already deleted message`);
          delete replies[id];
          return false;
        }

        throw e;
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

    Logger.info(`- Updating reply: ${text}`);
    replies[id] = await Message.update(saved_reply, message => {
      message.text = text;
      message.payload = payload;
    });

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
    }).then(message => {
      replies[id] = message;
      return true;
    });
  }

  async function remove_reaction(type) {
    if (!(type in reactions)) {
      return false;
    }
    const name = reactions[type];

    Logger.info(`- Removing reaction of type: ${type} (${reactions[type]})`);
    Logger.add_call('slack.reactions.remove');

    return Slack.remove_reaction(name, channel, ts)
      .then(() => {
        delete reactions[type];
        return true;
      })
      .catch(e => {
        if (e.data && e.data.error === 'no_reaction') {
          delete reactions[type];
          return false;
        }
        throw e;
      });
  }

  async function add_reaction(type, name) {
    if (type in reactions) {
      if (reactions[type] === name) return false;
      await remove_reaction(type);
    }

    Logger.info(`- Adding reaction of type: ${type} (${name})`);
    Logger.add_call('slack.reactions.add');

    return Slack.add_reaction(name, channel, ts)
      .then(() => {
        reactions[type] = name;
        return true;
      })
      .catch(e => {
        if (e.data && e.data.error === 'already_reacted') {
          reactions[type] = name;
          return false;
        }
        throw e;
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

              known_mergeable_state =
                data.state === 'closed' ||
                data.merged ||
                data.mergeable != null;
            } else if (status === 502) {
              known_mergeable_state = false;
            } else {
              break;
            }

            if (known_mergeable_state === false) {
              Logger.warn(
                `[${status}] Unknown mergeable state for ${slug}. Retrying...`,
              );
              await new Promise(r => setTimeout(r, 800));
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

    const has_status = status => responses.some(r => r.status === status);

    if (has_status(520)) return { error: { status: 520 } };
    if (has_status(403)) return { error: { status: 403 } };
    if (has_status(404)) return { error: { status: 404 } };

    const [pr_response, review_response, files_response] = responses;

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

    if (error) return { error };

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

    const { title, body, additions, deletions, mergeable } = pr_data;
    const files = files_data.map(
      ({ filename, status, additions, deletions }) => {
        return { filename, status, additions, deletions };
      },
    );

    return {
      title,
      description: body,
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

  function has_comment() {
    return state.actions.some(item => item.action === ACTIONS.commented);
  }

  function has_changes_requested() {
    return state.actions.some(
      item => item.action === ACTIONS.changes_requested,
    );
  }

  function is_trivial() {
    return (state.title + state.description).includes('#trivial');
  }

  function is_draft() {
    return state.mergeable_state === 'draft';
  }

  function is_mergeable() {
    if (state.closed) return false;
    return state.mergeable_state === 'clean';
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

  function is_waiting_review() {
    return (
      state.actions.length === 0 ||
      state.actions.some(
        item =>
          item.action === ACTIONS.dismissed ||
          item.action === ACTIONS.review_requested,
      )
    );
  }

  async function can_be_merged() {
    const { base_branch } = state;
    if (base_branch !== 'master' && base_branch.match(/\d\.x/i) == null) {
      return { can_merge: true };
    }

    const defcon_status = await check_defcon();
    if (defcon_status == null) return { can_merge: true };

    return {
      can_merge:
        defcon_status.level !== 'critical' && defcon_status.level !== 'warning',
      defcon: defcon_status,
    };
  }

  function has_pending_review() {
    return state.actions.some(item => item.action === ACTIONS.pending_review);
  }

  async function update_header_message() {
    const { actions, size, title } = state;

    const text_parts = [
      `:${EMOJIS.info}: *Title*: ${title}\n\n`,
      `:${EMOJIS[`size_${size.label}`]}: *PR size*: ${size.label} (_${
        size.n_changes
      } changes_)\n\n`,
      actions.length === 0
        ? `:${EMOJIS.waiting}: Waiting for reviewers`
        : () => {
            const header_text = Object.entries(
              actions.reduce((acc, { id, github_user, action }) => {
                if (!(action in acc)) acc[action] = [];

                const mention = id ? Message.get_user_mention(id) : github_user;
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

    const changes_requested = has_changes_requested();

    await add_reaction('size', EMOJIS[`size_${size.label}`]);

    if (changes_requested) {
      await add_reaction('changes_requested', EMOJIS.changes_requested);
    } else {
      await remove_reaction('changes_requested');
    }

    if (is_mergeable() && changes_requested === false) {
      const n_approvals = get_approvals();
      await add_reaction(
        'approved',
        n_approvals > 0 ? EMOJIS.approved : EMOJIS.ready_to_merge,
      );
    } else {
      await remove_reaction('approved');
    }

    if (has_comment()) {
      await add_reaction('has_comment', EMOJIS.commented);
    } else {
      await remove_reaction('has_comment');
    }

    if (is_waiting_review()) {
      await add_reaction('is_waiting_review', EMOJIS.waiting);
    } else {
      await remove_reaction('is_waiting_review');
    }

    if (has_pending_review()) {
      await add_reaction('pending_review', EMOJIS.pending_review);
    } else {
      await remove_reaction('pending_review');
    }

    if (is_dirty()) {
      await add_reaction('dirty', EMOJIS.dirty);
    } else {
      await remove_reaction('dirty');
    }

    if (merged) {
      await add_reaction('merged', EMOJIS.merged);
    } else {
      await remove_reaction('merged');
    }

    if (closed && !merged) {
      await add_reaction('closed', EMOJIS.closed);
    } else {
      await remove_reaction('closed');
    }
  }

  async function update_replies() {
    const { error, head_branch, base_branch } = state;

    if (error) {
      if (error.status === 404 || error.status === 403) {
        await reply(
          'error',
          `Sorry, but I think my <${GITHUB_APP_URL}|Github App> is not installed on this repository :thinking_face:. Please post this pull request again after installing the app (•ᴥ•)`,
        );
      } else if (error.status === 520) {
        await reply(
          'error',
          `Sorry, but something awful happened :scream:. I can't see this PR status...`,
        );
      }
      return;
    } else {
      await delete_reply('error');
    }

    await update_header_message();

    if (is_dirty()) {
      await reply(
        'is_dirty',
        `The branch \`${head_branch}\` is dirty. It may need a rebase with \`${base_branch}\`.`,
      );
    } else {
      await delete_reply('is_dirty');
    }

    if (is_trivial() === false && has_changelog() === false) {
      await reply(
        'modified_changelog',
        `I couln't find an addition to the \`CHANGELOG.md\`.\n\nDid you forget to add it :notsure:?`,
      );
    } else {
      await delete_reply('modified_changelog');
    }

    if (is_mergeable() === false) {
      await delete_reply('ready_to_merge');
    } else {
      let text;
      const { can_merge, defcon } = await can_be_merged();
      if (can_merge === false) {
        text = `This PR would be ready to be merged, but we're at *DEFCON ${defcon.id}* :harold-pain:. ${defcon.message}.`;
      } else {
        const n_approvals = get_approvals();
        const is_release_branch = !!base_branch.match(
          /^(?:master|release[\/-]?|(?:\d\.)+x)/i,
        );
        if (n_approvals === 0 && is_release_branch) {
          text = `PR is ready to be merged, but I can't seem to find any reviews approving it :notsure-left:.\n\nIs there a merge protection rule configured for the \`${base_branch}\` branch?`;
        } else {
          text = 'PR is ready to be merged :doit:!';
        }

        if (defcon && defcon.level === 'info') {
          text += `\n\nRemember that we're at *DEFCON ${defcon.id}* :apruved:. ${defcon.message}.`;
        }
      }

      await reply('ready_to_merge', text);
    }
  }

  function is_unreachable() {
    return (
      state.error &&
      (state.error.status === 403 ||
        state.error.status === 404 ||
        state.error.status === 520)
    );
  }

  async function update() {
    try {
      await update_lock.acquire();
      state = await get_consolidated_state();

      if (is_unreachable()) {
        Logger.info(`Can't update: ${slug}. Forbidden or not found.`);
      } else {
        Logger.info(`Updated state: ${slug}`);
        await Promise.all([update_reactions(), update_replies()]);
      }
    } catch (e) {
      Logger.error(e, `Something went wrong with "${slug}":`);
      // throw e;
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
    change_thread_ts(new_channel, new_ts) {
      channel = new_channel;
      ts = new_ts;
      replies = {};
      reactions = {};
    },
    // we debounce the update method so many consecutive updates fire just once
    update: debounce(update, 400),
    get_message_url,
    get_message_link: async fn => `<${[await get_message_url()]}|${fn(self)}>`,
    reply,
    update_reply,
    delete_reply,
    delete_replies,
    has_changes_requested,
    has_comment,
    is_trivial,
    is_draft,
    is_mergeable,
    is_dirty,
    is_unstable,
    is_resolved,
    is_active,
    is_unreachable,
    needs_attention(hours) {
      return is_active() && this.minutes_since_post >= 60 * hours;
    },
    invalidate_etag_signature,
    to_json,
  });

  return self;
};
