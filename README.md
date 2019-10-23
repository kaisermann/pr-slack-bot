# Pull Request Slack Bot

> TODO: an actual readme

## Features

### Slash commands

- `/pr help` - list all emoji meanings and commands;
- `/pr list` - list all open prs on the channel;
- `/pr list mine` - list all of your PRs on the channel;
- `/pr list @user` - list all PRs on the channel from a specific user;
- `/pr list @userGroup` - list all PRs on the channel from a specific user group;

### Mentions

- `@Paul Robotson roulette|random` - on a PR Thread, mention a random person from the channel;
- `@Paul Robotson roulette|random group-name` - on a PR Thread, mention a random person from a specific slack group. No need to prepend the `@`.

### Utilities

- add a `#trivial` to your PR title or body to prevent checking for a `CHANGELOG` update.

### Emojis

- `:pr-small:` - PR of small size (<=80 changes);
- `:pr-medium:` - PR of small size (<=250 changes);
- `:pr-large:` - PR of small size (<=800 changes);
- `:pr-xlarge:` - PR of small size (>801 changes);
- `:eyes:` - Someone is reviewing;
- `:sonic_waiting:` - Awaiting reviews;
- `:speech_balloon:` - Someone has commented;
- `:changes:` - Some changes were requested;
- `:warning:` - The head branch is dirty and may need a rebase with the base branch;
- `:ready-to-merge:` - Ready to be merged without approvals;
- `:white_check_mark:` - Ready to be merged AND approved;
- `:merged:` - PR was merged;
- `:closedpr:` - PR was closed;
- `:shrug:` - Some unknown action was taken. Please report it :robot_face:.

The code for each emoji interaction can be changed in the `src/consts.js` file.

## Developing

- `npm run dev` - Listen only to messages from the test channels defined on `consts.js`
- `npm run start` - Start the bot on production mode
