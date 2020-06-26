import { db } from '../firebase'

export function getRepoID({ owner, repo }: RepoIdentifier) {
  return `${owner}@${repo}`
}

export function getRepoRef({ owner, repo }: RepoIdentifier) {
  return db.collection('repos').doc(getRepoID({ owner, repo }))
}

export function getRepoPullRequestCollection({ owner, repo }: RepoIdentifier) {
  return getRepoRef({ owner, repo }).collection('prs')
}
