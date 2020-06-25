import { App } from '@octokit/app'
import { request } from '@octokit/request'

import { db } from '../firebase'

const APP_ID =
  process.env.NODE_ENV === 'production'
    ? process.env.APP_ID
    : process.env.DEV_APP_ID

const PRIVATE_KEY =
  process.env.NODE_ENV === 'production'
    ? process.env.APP_PRIVATE_KEY
    : process.env.DEV_APP_PRIVATE_KEY

const githubApp = new App({
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  id: +APP_ID!,
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  privateKey: PRIVATE_KEY!,
})

let jwtToken = githubApp.getSignedJsonWebToken()

// renew after 9:30 mins
setInterval(() => {
  jwtToken = githubApp.getSignedJsonWebToken()
}, 1000 * (60 * 10 - 30))

const getInstallationId = async ({ owner, repo }) => {
  const { data } = await request(`GET /repos/${owner}/${repo}/installation`, {
    headers: {
      authorization: `Bearer ${jwtToken}`,
      accept: 'application/vnd.github.machine-man-preview+json',
    },
  })

  return data.id
}

const ghFetch = async (url: string, options) => {
  const { owner, repo } = options
  const requestHeaders = { ...options.headers }
  const repoID = `${owner}@${repo}`
  const installationDoc = await db
    .collection('github_installations')
    .doc(repoID)
    .get()

  let installationId: number

  if (!installationDoc.exists) {
    installationId = await getInstallationId({ owner, repo })
    await db
      .collection('github_installations')
      .doc(repoID)
      .set({ installationId })
  } else {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    installationId = installationDoc.data()!.installationId
  }

  try {
    const installationAccessToken = await githubApp.getInstallationAccessToken({
      installationId,
    })

    const response = await request(url, {
      ...options,
      headers: {
        ...requestHeaders,
        authorization: `token ${installationAccessToken}`,
      },
    })

    return response
  } catch (e) {
    return e
  }
}

export function getReviewData({ owner, repo, number }) {
  return ghFetch('GET /repos/:owner/:repo/pulls/:pull_number/reviews', {
    owner,
    repo,
    pull_number: number,
  })
    .then(({ status, data }) => {
      return { status, data }
    })
    .catch((e) => {
      console.error(e)
      const { status } = e

      return { status, data: {} }
    })
}

export function getFilesData({ owner, repo, number }) {
  return ghFetch('GET /repos/:owner/:repo/pulls/:pull_number/files', {
    owner,
    repo,
    pull_number: number,
    per_page: 300,
  })
    .then(({ status, data }) => {
      return { status, data }
    })
    .catch((e) => {
      console.error(e)
      const { status } = e

      return { status, data: {} }
    })
}

function getPullRequestDataInternal({ owner, repo, number }) {
  return ghFetch('GET /repos/:owner/:repo/pulls/:pull_number', {
    owner,
    repo,
    pull_number: number,
  })
    .then(({ status, data }) => {
      return { status, data }
    })
    .catch((e) => {
      console.error(e)
      const { status } = e

      return { status, data: {} }
    })
}

export async function getPullRequestMetaData({ owner, repo, number }) {
  const slug = `${owner}/${repo}/${number}`

  // we make a promise that only resolves when a PR mergeability is known
  try {
    let knownMergeableState = false
    let data: any
    let status: number

    do {
      // eslint-disable-next-line no-await-in-loop
      const response = await getPullRequestDataInternal({ owner, repo, number })

      data = response?.data
      status = response.status

      if (status === 200 || status === 304) {
        knownMergeableState =
          data.state === 'closed' || data.merged || data.mergeable != null
      } else if (status === 502) {
        knownMergeableState = false
      } else {
        break
      }

      if (knownMergeableState === false) {
        console.warn(
          `[${status}] Unknown mergeable state for ${slug}. Retrying...`
        )
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 800))
      }
    } while (knownMergeableState === false)

    return { status, data }
  } catch (e) {
    return { status: 520 }
  }
}
