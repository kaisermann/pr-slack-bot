import { EMOJIS } from '../../consts'

const ACTIONS = Object.freeze({
  approved: 'APPROVED',
  dismissed: 'DISMISSED',
  changes_requested: 'CHANGES_REQUESTED',
  pending_review: 'PENDING',
  review_requested: 'REVIEW_REQUESTED',
  commented: 'COMMENTED',
  merged: 'MERGED',
  unknown: 'UNKNOWN',
})

export function reduceAction(actionList) {
  const lastApprovedIdx = actionList.lastIndexOf(ACTIONS.approved)
  const lastChangeRequestIdx = actionList.lastIndexOf(ACTIONS.changes_requested)

  if (lastChangeRequestIdx > lastApprovedIdx) {
    return ACTIONS.changes_requested
  }

  const lastDismissedIdx = actionList.lastIndexOf(ACTIONS.dismissed)

  if (lastDismissedIdx < lastApprovedIdx) {
    return ACTIONS.approved
  }

  if (lastDismissedIdx >= 0) {
    return ACTIONS.dismissed
  }

  if (actionList.includes(ACTIONS.review_requested)) {
    return ACTIONS.review_requested
  }

  if (actionList.includes(ACTIONS.pending_review)) {
    return ACTIONS.pending_review
  }

  if (actionList.includes(ACTIONS.commented)) {
    return ACTIONS.commented
  }

  return ACTIONS.unknown
}

export function getActionLabel(action) {
  if (action === ACTIONS.approved) {
    return { label: 'Approved', emoji: EMOJIS.approved }
  }

  if (action === ACTIONS.changes_requested) {
    return { label: 'Changes requested', emoji: EMOJIS.changes_requested }
  }

  if (action === ACTIONS.pending_review) {
    return { label: 'Is reviewing', emoji: EMOJIS.pending_review }
  }

  if (action === ACTIONS.review_requested) {
    return { label: 'Waiting review', emoji: EMOJIS.waiting }
  }

  if (action === ACTIONS.dismissed) {
    return { label: 'Outdated review', emoji: EMOJIS.waiting }
  }

  if (action === ACTIONS.commented) {
    return { label: 'Commented', emoji: EMOJIS.commented }
  }

  if (action === ACTIONS.merged) {
    return { label: 'Merged by', emoji: EMOJIS.merged }
  }

  return { label: 'Unknown action', emoji: EMOJIS.unknown }
}

export function getActionMap({ metaData, reviewData }) {
  const actions = {}

  for (const { login } of metaData.requested_reviewers) {
    actions[login] = [ACTIONS.review_requested]
  }

  for (const review of reviewData) {
    if (metaData.assignee == null || review.user !== metaData.assignee.login) {
      continue
    }

    const {
      user: { login },
      state,
    } = review

    if (!(login in actions)) {
      actions[login] = []
    }

    actions[login].push(state)
  }

  if (metaData.merged_by != null) {
    const merger = metaData.merged_by.login

    if (!(merger in actions)) {
      actions[merger] = []
    }

    actions[merger].push({ githubUser: merger, action: ACTIONS.merged })
  }

  return actions
}

export function reduceActions(actions: Record<string, string[]>) {
  return Object.entries(actions).map(([githubUser, actionList]) => {
    return {
      githubUser,
      action: reduceAction(actionList),
    }
  })
}

export function groupByAction(reducedActions: PullRequestAction[]) {
  const grouped: Record<string, string[]> = {}

  for (const { githubUser, action } of reducedActions) {
    if (!(action in grouped)) {
      grouped[action] = []
    }

    grouped[action].push(githubUser)
  }

  return Object.entries(grouped)
}

export function getApprovalCount(pr: PullRequestDocument) {
  return reduceActions(pr.actions).filter((a) => a.action === ACTIONS.approved)
    .length
}

export function hasComment(pr: PullRequestDocument) {
  return reduceActions(pr.actions).some(
    (item) => item.action === ACTIONS.commented
  )
}

export function hasChangesRequested(pr: PullRequestDocument) {
  return reduceActions(pr.actions).some(
    (item) => item.action === ACTIONS.changes_requested
  )
}

export function isWaitingReview(pr: PullRequestDocument) {
  const reducedActions = reduceActions(pr.actions)

  return (
    reducedActions.length === 0 ||
    reducedActions.some(
      (item) =>
        item.action === ACTIONS.dismissed ||
        item.action === ACTIONS.review_requested
    )
  )
}

export function hasPendingReview(pr: PullRequestDocument) {
  return reduceActions(pr.actions).some(
    (item) => item.action === ACTIONS.pending_review
  )
}
