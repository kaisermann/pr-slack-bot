import 'dotenv/config'
import * as admin from 'firebase-admin'

export const app = admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  databaseURL: 'https://paul-robotson.firebaseio.com',
})

export const db = admin.firestore()

db.settings({ ignoreUndefinedProperties: true })
