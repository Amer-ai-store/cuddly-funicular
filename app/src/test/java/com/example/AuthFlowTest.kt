package com.example

import android.content.Context
import android.os.Looper
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.example.data.*
import com.example.ui.MarketViewModel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class AuthFlowTest {

    private lateinit var db: AppDatabase
    private lateinit var viewModel: MarketViewModel

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        viewModel = MarketViewModel(
            db.userDao(),
            db.productDao(),
            db.savedProductDao(),
            db.orderDao(),
            db.chatReportDao(),
            db.cartItemDao(),
            db.bankCardDao(),
            db.searchQueryDao(),
            db.familyShoppingListDao(),
            db.storedOrganicItemDao(),
            LocalAuthBackend(db.credentialDao())
        )
    }

    @After
    fun tearDown() {
        db.close()
    }

    /** viewModelScope runs on the main looper and Room/PBKDF2 on other threads, so pump until [condition] holds. */
    private fun awaitUntil(condition: suspend () -> Boolean) = runBlocking {
        repeat(500) {
            shadowOf(Looper.getMainLooper()).idle()
            if (condition()) return@runBlocking
            Thread.sleep(10)
        }
        fail("Condition was not met in time")
    }

    private fun register(email: String, password: String, phone: String = "0790000001") {
        viewModel.initiateRegister("Buyer", phone, email, "Customer", password)
        awaitUntil { viewModel.verificationCodeSent.value != null }
        viewModel.confirmCode(viewModel.verificationCodeSent.value!!)
        awaitUntil { viewModel.currentUser.value != null || viewModel.errorMessage.value != null }
    }

    private fun signOut() {
        viewModel.logout()
        viewModel.clearError()
        assertNull(viewModel.currentUser.value)
    }

    /** Waits for login() to either open an account or report an error. */
    private fun signIn(identifier: String, password: String) {
        viewModel.login(identifier, password)
        awaitUntil { viewModel.currentUser.value != null || viewModel.errorMessage.value != null }
    }

    @Test
    fun registeredUserSignsInOnlyWithTheRightPassword() {
        register("Buyer@Example.com", "secret12")
        assertEquals("buyer@example.com", viewModel.currentUser.value?.email)
        signOut()

        signIn("buyer@example.com", "wrong999")
        assertNull(viewModel.currentUser.value)
        assertNotNull(viewModel.errorMessage.value)
        viewModel.clearError()

        signIn("BUYER@example.com", "secret12")
        assertEquals("buyer@example.com", viewModel.currentUser.value?.email)
    }

    @Test
    fun unknownEmailNoLongerCreatesAnAccount() {
        signIn("stranger@example.com", "secret12")

        assertNull(viewModel.currentUser.value)
        assertNotNull(viewModel.errorMessage.value)
        assertEquals(0, runBlocking { db.userDao().getAllUsers().first().size })
    }

    @Test
    fun phoneNumberSignsInThroughItsAccountEmail() {
        register("buyer@example.com", "secret12", phone = "+962790000001")
        signOut()

        signIn("+962790000001", "secret12")
        assertEquals("buyer@example.com", viewModel.currentUser.value?.email)
    }

    @Test
    fun passwordIsStoredOnlyAsASaltedHash() {
        register("buyer@example.com", "secret12")

        val credential = runBlocking { db.credentialDao().getCredential("buyer@example.com") }!!
        assertFalse(credential.passwordHash.contains("secret12"))
        assertNotEquals("", credential.salt)
        assertEquals(100_000, credential.iterations)
    }

    @Test
    fun sameEmailCannotRegisterTwice() {
        register("buyer@example.com", "secret12")
        signOut()

        register("buyer@example.com", "other999")
        assertNull(viewModel.currentUser.value)
        assertNotNull(viewModel.errorMessage.value)
        assertEquals(1, runBlocking { db.userDao().getAllUsers().first().size })
    }

    @Test
    fun weakPasswordIsRejectedBeforeTheCodeStep() {
        viewModel.initiateRegister("Buyer", "", "buyer@example.com", "Customer", "abcdef")

        assertNotNull(viewModel.errorMessage.value)
        assertEquals(0, viewModel.verificationStep.value)
    }

    @Test
    fun adminEmailCannotBeRegistered() {
        viewModel.initiateRegister("Mallory", "", "ZXZX.mohammad91@gmail.com", "Customer", "secret12")

        assertNotNull(viewModel.errorMessage.value)
        assertEquals(0, viewModel.verificationStep.value)
    }

    @Test
    fun changingPasswordNeedsTheCurrentOne() {
        register("buyer@example.com", "secret12")

        var result: AuthError? = AuthError.UNKNOWN
        var done = false
        viewModel.changePassword("wrong999", "newpass34") { result = it; done = true }
        awaitUntil { done }
        assertEquals(AuthError.INVALID_CREDENTIALS, result)

        done = false
        viewModel.changePassword("secret12", "newpass34") { result = it; done = true }
        awaitUntil { done }
        assertNull(result)

        signOut()
        signIn("buyer@example.com", "secret12")
        assertNull(viewModel.currentUser.value)
        viewModel.clearError()
        signIn("buyer@example.com", "newpass34")
        assertNotNull(viewModel.currentUser.value)
    }

    @Test
    fun accountFromAnOlderVersionIsReusedWhenItsOwnerRegisters() {
        val oldId = runBlocking {
            db.userDao().insertUser(UserEntity(name = "Old", phoneNumber = "0791111111", email = "buyer@example.com", role = "Customer", loyaltyPoints = 40)).toInt()
        }
        register("buyer@example.com", "secret12", phone = "")

        assertEquals(oldId, viewModel.currentUser.value?.id)
        assertEquals(40, viewModel.currentUser.value?.loyaltyPoints)
        assertEquals("0791111111", viewModel.currentUser.value?.phoneNumber)
    }
}
