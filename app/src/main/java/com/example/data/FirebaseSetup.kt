package com.example.data

import android.content.Context
import android.util.Log
import com.example.BuildConfig
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

/** Builds Firebase apps from the FIREBASE_* keys in .env. Everything Firebase stays off while they are placeholders. */
object FirebaseSetup {
    private const val TAG = "FirebaseSetup"
    private const val PLACEHOLDER_PREFIX = "MY_FIREBASE_"

    fun isConfigured(): Boolean =
        listOf(BuildConfig.FIREBASE_API_KEY, BuildConfig.FIREBASE_APP_ID, BuildConfig.FIREBASE_PROJECT_ID)
            .all { it.isNotBlank() && !it.startsWith(PLACEHOLDER_PREFIX) }

    /** The named app (each name keeps its own sign-in state), or null when keys are missing or setup fails. */
    @Synchronized
    fun app(context: Context, name: String): FirebaseApp? {
        if (!isConfigured()) return null
        return try {
            FirebaseApp.getApps(context).firstOrNull { it.name == name }
                ?: FirebaseApp.initializeApp(
                    context.applicationContext,
                    FirebaseOptions.Builder()
                        .setApiKey(BuildConfig.FIREBASE_API_KEY)
                        .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                        .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                        .build(),
                    name
                )
        } catch (e: Exception) {
            Log.e(TAG, "Firebase initialization of $name failed.", e)
            null
        }
    }
}
