"use client";

import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";
import { getAuth, Auth } from "firebase/auth";

// Firebase configuration
// Note: These values should be in environment variables in production
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase
let app: FirebaseApp | undefined;
let db: Firestore | undefined;
let auth: Auth | undefined;

export function getFirebaseApp(): FirebaseApp {
    if (!app) {
        if (getApps().length === 0) {
            app = initializeApp(firebaseConfig);
        } else {
            app = getApps()[0];
        }
    }
    return app;
}

export function getFirestoreDb(): Firestore {
    if (!db) {
        db = getFirestore(getFirebaseApp());
    }
    return db;
}

export function getFirebaseAuth(): Auth {
    if (!auth) {
        auth = getAuth(getFirebaseApp());
    }
    return auth;
}

// Check if Firebase is configured
export function isFirebaseConfigured(): boolean {
    return !!(
        process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    );
}
