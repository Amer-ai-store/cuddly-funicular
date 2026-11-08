package com.example.data

import android.content.Context
import com.google.firebase.auth.FirebaseAuth

/** Why a sign-up, sign-in or password change was refused. */
enum class AuthError {
    INVALID_CREDENTIALS,
    EMAIL_IN_USE,
    WEAK_PASSWORD,
    RECENT_LOGIN_REQUIRED,
    TOO_MANY_ATTEMPTS,
    NETWORK,
    PROVIDER_DISABLED,
    UNKNOWN
}

class AuthException(val error: AuthError, cause: Throwable? = null) : Exception(error.name, cause)

/**
 * Proves who is signing in with an email and password. The Room users table still holds the profile
 * (name, phone, role); this only checks credentials. Every failure is thrown as [AuthException].
 */
interface AuthBackend {
    /** Email of a session kept from an earlier launch, or null. */
    fun signedInEmail(): String?

    suspend fun register(email: String, password: String)

    suspend fun signIn(email: String, password: String)

    /** Checks [currentPassword] again before setting [newPassword]. */
    suspend fun changePassword(email: String, currentPassword: String, newPassword: String)

    fun signOut()

    companion object {
        private const val FIREBASE_APP_NAME = "amer-user-auth"

        /**
         * Firebase Auth when the FIREBASE_* keys are set, so accounts work on every device; otherwise
         * passwords are hashed into this device's database. User sign-in uses its own Firebase app so
         * it never replaces the anonymous session FirestoreSync writes with.
         */
        fun create(context: Context, db: AppDatabase): AuthBackend =
            FirebaseSetup.app(context, FIREBASE_APP_NAME)
                ?.let { FirebaseAuthBackend(FirebaseAuth.getInstance(it)) }
                ?: LocalAuthBackend(db.credentialDao())
    }
}

/** Normalizes emails so "Ali@Mail.com" and "ali@mail.com" are one account, as in Firebase Auth. */
fun normalizeEmail(email: String): String = email.trim().lowercase()
