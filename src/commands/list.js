const runtime = require('../runtime.js');
const format_section_pr_list = require('../messages/section_pr_list.js');

module.exports = async ({ channel_id, user_id, params }) => {
  const channel = runtime.get_channel(channel_id);

  if (!channel) return;

  if (params.length === 0) {
    return `Here's all PRs listed on this channel:\n\n${await format_section_pr_list(
      channel.prs,
    )}`;
  }

  if (params === 'mine') {
    const prs = channel.prs.filter(pr => pr.poster_id === user_id);

    if (prs.length === 0) {
      return "You don't have any pull requests listed on this channel";
    }
    return `Here's all PRs owned by you:\n\n${await format_section_pr_list(
      prs,
    )}`;
  }

  const match = params.match(/^<@(\w*?)\|[\w.-_]*?>$/im);
  if (match) {
    const mentioned_user = match[1];
    const prs = channel.prs.filter(pr => pr.poster_id === mentioned_user);

    if (prs.length === 0) {
      return `<@${mentioned_user}> don't have any pull requests listed on this channel`;
    }

    return `Here's all PRs owned by <@${mentioned_user}>:\n\n${await format_section_pr_list(
      prs,
    )}`;
  }

  return 'Invalid command parameters: `/pr list [ |mine|@user]`';
};
