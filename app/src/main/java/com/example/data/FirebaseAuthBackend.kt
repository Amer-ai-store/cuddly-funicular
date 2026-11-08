package com.example.data

import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.FirebaseTooManyRequestsException
import com.google.firebase.auth.EmailAuthProvider
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthInvalidUserException
import com.google.firebase.auth.FirebaseAuthRecentLoginRequiredException
import com.google.firebase.auth.FirebaseAuthUserCollisionException
import com.google.firebase.auth.FirebaseAuthWeakPasswordException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/** Email/password accounts in Firebase Authentication. Needs the Email/Password provider enabled in the console. */
class FirebaseAuthBackend(private val auth: FirebaseAuth) : AuthBackend {

    override fun signedInEmail(): String? = auth.currentUser?.takeUnless { it.isAnonymous }?.email

    override suspend fun register(email: String, password: String) = mapErrors {
        auth.createUserWithEmailAndPassword(normalizeEmail(email), password).await()
    }

    override suspend fun signIn(email: String, password: String) = mapErrors {
        auth.signInWithEmailAndPassword(normalizeEmail(email), password).await()
    }

    override suspend fun changePassword(email: String, currentPassword: String, newPassword: String) = mapErrors {
        val user = auth.currentUser ?: throw AuthException(AuthError.INVALID_CREDENTIALS)
        user.reauthenticate(EmailAuthProvider.getCredential(normalizeEmail(email), currentPassword)).await()
        user.updatePassword(newPassword).await()
    }

    override fun signOut() = auth.signOut()

    private suspend fun mapErrors(block: suspend () -> Any?) {
        try {
            block()
        } catch (e: AuthException) {
            throw e
        } catch (e: Exception) {
            throw AuthException(toAuthError(e), e)
        }
    }

    private fun toAuthError(e: Exception): AuthError = when (e) {
        // Weak-password is a subclass of invalid-credentials, so it must be matched first.
        is FirebaseAuthWeakPasswordException -> AuthError.WEAK_PASSWORD
        is FirebaseAuthUserCollisionException -> AuthError.EMAIL_IN_USE
        is FirebaseAuthRecentLoginRequiredException -> AuthError.RECENT_LOGIN_REQUIRED
        is FirebaseAuthInvalidCredentialsException, is FirebaseAuthInvalidUserException -> AuthError.INVALID_CREDENTIALS
        is FirebaseTooManyRequestsException -> AuthError.TOO_MANY_ATTEMPTS
        is FirebaseNetworkException -> AuthError.NETWORK
        is FirebaseAuthException ->
            if (e.errorCode == "ERROR_OPERATION_NOT_ALLOWED") AuthError.PROVIDER_DISABLED else AuthError.UNKNOWN
        else -> AuthError.UNKNOWN
    }
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { cont ->
    addOnCompleteListener { task ->
        if (task.isSuccessful) {
            cont.resume(task.result)
        } else {
            cont.resumeWithException(task.exception ?: IllegalStateException("Firebase task failed"))
        }
    }
}
