import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

// 未設定時のダミー（ビルドは通る、実行時は警告）
const isConfigured = !!firebaseConfig.apiKey && firebaseConfig.apiKey !== 'your_api_key'
if (!isConfigured) {
  console.warn('[firebase] .env が未設定です。.env.example をコピーして設定してください。')
}

let app, auth, db
try {
  app = initializeApp(isConfigured ? firebaseConfig : {
    apiKey: "demo",
    authDomain: "demo.firebaseapp.com",
    projectId: "demo",
  })
  auth = getAuth(app)
  db = getFirestore(app)
} catch (e) {
  console.error('[firebase] init failed', e)
}

export { app, auth, db, isConfigured }
export const isFirebaseReady = () => isConfigured && !!auth && !!db
