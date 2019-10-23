const DB = require('../../api/db.js');
const runtime = require('../../runtime.js');
const Message = require('../../message.js');
const get_sectioned_pr_blocks = require('../../messages/section_pr_list.js');

module.exports = async ({ channel_id, user_id, params }) => {
  const channel = runtime.get_channel(channel_id);

  if (!channel) {
    return `Sorry, but it seems I'm not tracking any PR from this channel.`;
  }

  if (params.length === 0) {
    return [
      Message.blocks.create_markdown_section(
        `Here's all PRs listed on this channel:`,
      ),
    ].concat(await get_sectioned_pr_blocks(channel.prs));
  }

  if (params === 'mine') {
    const prs = channel.prs.filter(pr => pr.poster_id === user_id);

    if (prs.length === 0) {
      return "You don't have any pull requests listed on this channel";
    }

    return [
      Message.blocks.create_markdown_section(`Here's all PRs owned by you:`),
    ].concat(await get_sectioned_pr_blocks(prs));
  }

  const group_match = Message.match_group_mention(params);
  if (group_match) {
    const matched_group_id = group_match[1];
    const members = new Set(
      DB.users.get(['groups', matched_group_id, 'users'], []).value(),
    );
    const prs = channel.prs.filter(pr => members.has(pr.poster_id));

    if (prs.length === 0) {
      return `${Message.get_group_mention(
        matched_group_id,
      )} don't have any pull requests listed on this channel`;
    }

    return [
      Message.blocks.create_markdown_section(
        `Here's all PRs owned by ${Message.get_group_mention(
          matched_group_id,
        )}:`,
      ),
    ].concat(await get_sectioned_pr_blocks(prs));
  }

  const user_match = Message.match_user_mention(params);
  if (user_match) {
    const matched_user_id = user_match[1];
    const prs = channel.prs.filter(pr => pr.poster_id === matched_user_id);

    if (prs.length === 0) {
      return `${Message.get_user_mention(
        matched_user_id,
      )} don't have any pull requests listed on this channel`;
    }

    return [
      Message.blocks.create_markdown_section(
        `Here's all PRs owned by ${Message.get_user_mention(matched_user_id)}:`,
      ),
    ].concat(await get_sectioned_pr_blocks(prs));
  }

  return 'Invalid command parameters: `/pr list [ |mine|@user|@userGroup]`';
};
