import { getFullUsers, getUserGroups } from './slack/api'
import { db } from '../firebase'
import { GITHUB_FIELD_ID } from '../consts'

export async function updateUser(id, user: SlackUser) {
  console.log(`Updating user: ${id}`)

  const {
    profile: { status_text, display_name, fields },
  } = user

  const githubField = fields?.[GITHUB_FIELD_ID]

  if (githubField == null) {
    return
  }

  const githubUser = githubField.value.replace(
    /(?:https:\/\/github.com\/|^@)([\w-.]*)?/,
    '$1'
  )

  await db.collection('users').doc(id).set({
    id,
    slack_user: display_name,
    github_user: githubUser,
    status_text,
  })
}

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
  for await (const group of getUserGroups()) {
    await updateUserGroup(group.id, group)
  }
}

export async function updateUsers() {
  for await (const user of getFullUsers()) {
    await updateUser(user.id, user)
  }
}

export async function githubUserToSlackID(ghUser: string) {
  const userQuery = await db
    .collection('users')
    .where('github_user', '==', ghUser)
    .get()

  if (userQuery.empty) throw new Error('User not found')

  return userQuery.docs[0].id
}
