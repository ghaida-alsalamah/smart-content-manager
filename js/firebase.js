/* ============================================================
   firebase.js — Firebase initialization

   SETUP INSTRUCTIONS:
   1. Go to https://console.firebase.google.com/
   2. Create a new project (or use existing)
   3. Enable Authentication → Email/Password
   4. Enable Realtime Database (start in test mode)
   5. Go to Project Settings → Your apps → Add web app
   6. Copy your config values below
   ============================================================ */

const firebaseConfig = {
  apiKey:            "AIzaSyC010ZiwmcK6WWw66BGsb80bYQXgs98MWA",
  authDomain:        "tuwaiqthon.firebaseapp.com",
  databaseURL:       "https://tuwaiqthon-default-rtdb.firebaseio.com",
  projectId:         "tuwaiqthon",
  storageBucket:     "tuwaiqthon.firebasestorage.app",
  messagingSenderId: "241284476887",
  appId:             "1:241284476887:web:963a68769d949ae119e592"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Shortcuts used across the app
const auth = firebase.auth();
const db   = firebase.database();
