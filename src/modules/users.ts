import * as Slack from './slack/api'
import { db } from '../firebase'
import { GITHUB_FIELD_ID } from '../consts'

export async function updateUser(id, user: SlackUser) {
  const {
    profile: { status_text: statusText, display_name: displayName, fields },
  } = user

  const githubField = fields?.[GITHUB_FIELD_ID]

  if (githubField == null) {
    return
  }

  const githubUser = githubField.value.replace(
    /(?:https:\/\/github.com\/|^@)([\w-.]*)?/,
    '$1'
  )

  // todo: prevent reading/writing to the db. use some caching
  const userRef = db.collection('users').doc(id)

  console.log(`[read] users/${id}`)

  const userSnap = await userRef.get()

  if (userSnap.exists) {
    const userData = userSnap.data() as UserDocument

    // nothing relevant changed
    if (
      userData.github_user === githubUser &&
      userData.slack_user === displayName &&
      Slack.isVacationStatus(userData.status_text) ===
        Slack.isVacationStatus(statusText)
    ) {
      return
    }
  }

  console.log(`Updating slack user with github user: ${id} / ${githubUser}`)

  return userRef.set({
    id,
    slack_user: displayName,
    github_user: githubUser,
    status_text: statusText,
  })
}

// todo: prevent writing to the db if nothing relevant changed
export async function updateUserGroup(id: string, group: SlackGroup) {
  console.log(`Updating user group: ${id}`)

  if (group.deleted_by || group.users == null || group.users.length === 0) {
    return db.collection('user_groups').doc(id).delete()
  }

  return db.collection('user_groups').doc(group.id).set({
    id: group.id,
    handle: group.handle,
    name: group.name,
    users: group.users,
  })
}

export async function updateUserGroups() {
  for await (const group of await Slack.getUserGroups()) {
    await updateUserGroup(group.id, group)
  }
}

export async function updateUsers() {
  for await (const user of Slack.getFullUsers()) {
    await updateUser(user.id, user)
  }
}

export async function githubUserToSlackID(ghUser: string) {
  const userQuery = await db
    .collection('users')
    .where('github_user', '==', ghUser)
    .get()

  if (userQuery.empty) {
    throw new Error('User not found')
  }

  return userQuery.docs[0].id
}

export function getUserGroupRef(groupId: string) {
  return db.collection('user_groups').doc(groupId)
}

export function getUserRef(userId: string) {
  return db.collection('users').doc(userId)
}
