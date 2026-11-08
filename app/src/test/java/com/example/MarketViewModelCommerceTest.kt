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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class MarketViewModelCommerceTest {

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

    /** viewModelScope runs on the main looper and Room on its own threads, so pump both until [condition] holds. */
    private fun awaitUntil(condition: suspend () -> Boolean) = runBlocking {
        repeat(500) {
            shadowOf(Looper.getMainLooper()).idle()
            if (condition()) return@runBlocking
            Thread.sleep(10)
        }
        fail("Condition was not met in time")
    }

    private fun signInAsCustomer(): UserEntity {
        viewModel.initiateRegister("Buyer", "0790000001", "buyer@example.com", "Customer", "secret12")
        awaitUntil { viewModel.verificationCodeSent.value != null }
        viewModel.confirmCode(viewModel.verificationCodeSent.value!!)
        awaitUntil { viewModel.currentUser.value != null }
        return viewModel.currentUser.value!!
    }

    @Test
    fun customerCannotSwitchToAdmin() {
        signInAsCustomer()
        assertFalse("Admin" in viewModel.availableRoles.value)

        viewModel.switchRole("Admin")
        assertEquals("Customer", viewModel.currentRole.value)

        viewModel.switchRole("Merchant")
        assertEquals("Merchant", viewModel.currentRole.value)
    }

    @Test
    fun signUpCannotCreateAnAdmin() {
        viewModel.initiateRegister("Eve", "0790000009", "eve@example.com", "Admin", "secret12")
        awaitUntil { viewModel.verificationCodeSent.value != null }
        assertTrue(viewModel.confirmCode(viewModel.verificationCodeSent.value!!))
        awaitUntil { viewModel.currentUser.value != null }

        assertEquals("Customer", viewModel.currentUser.value?.role)
        assertEquals("Customer", viewModel.currentRole.value)
    }

    @Test
    fun adminAccountDoesNotOpenByPhoneEvenWithItsPassword() {
        runBlocking {
            db.userDao().insertUser(UserEntity(name = "admin", phoneNumber = "0590000000", email = "boss@example.com", role = "Admin"))
            LocalAuthBackend(db.credentialDao()).register("boss@example.com", "secret12")
        }
        viewModel.login("0590000000", "secret12")
        awaitUntil { viewModel.errorMessage.value != null }

        assertNull(viewModel.currentUser.value)
    }

    @Test
    fun checkoutTakesStockAndKeepsUnavailableItemsInCart() {
        val user = signInAsCustomer()
        val (plentyId, scarceId) = runBlocking {
            db.productDao().insertProduct(ProductEntity(name = "Dates", category = "Food", retailPrice = 5.0, wholesalePrice = 4.0, imageUrl = "", stockQuantity = 10, merchantName = "Al-Baraka")).toInt() to
                db.productDao().insertProduct(ProductEntity(name = "Saffron", category = "Food", retailPrice = 9.0, wholesalePrice = 8.0, imageUrl = "", stockQuantity = 1)).toInt()
        }
        val plenty = runBlocking { db.productDao().getProductByIdSuspend(plentyId)!! }
        val scarce = runBlocking { db.productDao().getProductByIdSuspend(scarceId)!! }

        viewModel.addProductToCart(plenty, 3, "Retail")
        viewModel.addProductToCart(scarce, 2, "Retail")
        awaitUntil { db.cartItemDao().getCartItemsOnce(user.id).size == 2 }

        viewModel.checkoutCart()
        // Loyalty points are awarded last (3 x 5.0 = 15), so wait for them rather than the cart, which empties earlier.
        awaitUntil { viewModel.currentUser.value?.loyaltyPoints == 15 }

        runBlocking {
            val orders = db.orderDao().getOrdersForCustomer(user.id).first()
            assertEquals(1, orders.size)
            assertEquals("Dates", orders[0].productName)
            assertEquals("Al-Baraka", orders[0].merchantName)
            assertEquals(7, db.productDao().getProductByIdSuspend(plentyId)!!.stockQuantity)
            assertEquals(3, db.productDao().getProductByIdSuspend(plentyId)!!.salesHistory)
            assertEquals(1, db.productDao().getProductByIdSuspend(scarceId)!!.stockQuantity)
            assertEquals("Saffron", db.cartItemDao().getCartItemsOnce(user.id).single().productName)
        }
        assertNotNull(viewModel.errorMessage.value)
    }

    @Test
    fun addingSameProductTwiceIncreasesQuantity() {
        val user = signInAsCustomer()
        val product = runBlocking {
            val id = db.productDao().insertProduct(ProductEntity(name = "Tea", category = "Food", retailPrice = 2.0, wholesalePrice = 1.5, imageUrl = "")).toInt()
            db.productDao().getProductByIdSuspend(id)!!
        }
        viewModel.addProductToCart(product, 1, "Retail")
        awaitUntil { db.cartItemDao().getCartItemsOnce(user.id).size == 1 }
        viewModel.addProductToCart(product, 2, "Retail")
        awaitUntil { db.cartItemDao().getCartItemsOnce(user.id).singleOrNull()?.quantity == 3 }
    }

    @Test
    fun dailyCheckInPaysOncePerDay() {
        val before = viewModel.cryptoWalletUsdt.value
        val reward = viewModel.performDailyCheckIn()
        assertNotNull(reward)
        assertNull(viewModel.performDailyCheckIn())
        assertEquals(before + reward!!, viewModel.cryptoWalletUsdt.value, 0.0001)
    }

    @Test
    fun linkedCardDoesNotKeepCvv() {
        val user = signInAsCustomer()
        viewModel.linkBankCard("4242424242424242", "Buyer", "12/30", "123")
        awaitUntil { db.bankCardDao().getBankCards(user.id).first().isNotEmpty() }

        assertEquals("", runBlocking { db.bankCardDao().getBankCards(user.id).first().single().cvv })
    }
}
