package com.example.data

import java.security.MessageDigest
import java.security.NoSuchAlgorithmException
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Device-only accounts for builds without Firebase keys: salted PBKDF2 hashes in the local_credentials table. */
class LocalAuthBackend(private val credentialDao: CredentialDao) : AuthBackend {

    // Sessions are not kept across launches on this backend.
    override fun signedInEmail(): String? = null

    override suspend fun register(email: String, password: String) {
        val key = normalizeEmail(email)
        if (credentialDao.getCredential(key) != null) throw AuthException(AuthError.EMAIL_IN_USE)
        credentialDao.upsertCredential(PasswordHasher.hash(key, password))
    }

    override suspend fun signIn(email: String, password: String) {
        val credential = credentialDao.getCredential(normalizeEmail(email))
        if (credential == null || !PasswordHasher.verify(credential, password)) {
            throw AuthException(AuthError.INVALID_CREDENTIALS)
        }
    }

    override suspend fun changePassword(email: String, currentPassword: String, newPassword: String) {
        signIn(email, currentPassword)
        credentialDao.upsertCredential(PasswordHasher.hash(normalizeEmail(email), newPassword))
    }

    override fun signOut() = Unit
}

internal object PasswordHasher {
    private const val ITERATIONS = 100_000
    private const val KEY_BITS = 256
    private const val SALT_BYTES = 16

    // PBKDF2WithHmacSHA256 needs API 26; minSdk is 24, so older devices fall back to SHA1.
    private val algorithm: String by lazy {
        try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            "PBKDF2WithHmacSHA256"
        } catch (e: NoSuchAlgorithmException) {
            "PBKDF2WithHmacSHA1"
        }
    }

    suspend fun hash(email: String, password: String): CredentialEntity {
        val salt = ByteArray(SALT_BYTES).also { SecureRandom().nextBytes(it) }
        return CredentialEntity(
            email = email,
            passwordHash = encode(derive(password, salt, algorithm, ITERATIONS)),
            salt = encode(salt),
            algorithm = algorithm,
            iterations = ITERATIONS
        )
    }

    suspend fun verify(credential: CredentialEntity, password: String): Boolean {
        val expected = decode(credential.passwordHash)
        val actual = derive(password, decode(credential.salt), credential.algorithm, credential.iterations)
        return MessageDigest.isEqual(expected, actual)
    }

    private suspend fun derive(password: String, salt: ByteArray, algorithm: String, iterations: Int): ByteArray =
        withContext(Dispatchers.Default) {
            val spec = PBEKeySpec(password.toCharArray(), salt, iterations, KEY_BITS)
            try {
                SecretKeyFactory.getInstance(algorithm).generateSecret(spec).encoded
            } finally {
                spec.clearPassword()
            }
        }

    // Hex rather than Base64: android.util.Base64 is stubbed in unit tests and java.util.Base64 needs API 26.
    private fun encode(bytes: ByteArray): String =
        bytes.joinToString("") { Integer.toHexString(it.toInt() and 0xff).padStart(2, '0') }

    private fun decode(hex: String): ByteArray = ByteArray(hex.length / 2) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
}
