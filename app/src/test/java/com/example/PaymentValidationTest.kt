package com.example

import com.example.ui.PaymentValidation
import java.util.Calendar
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PaymentValidationTest {

    private val october2026 = Calendar.getInstance().apply { set(2026, Calendar.OCTOBER, 25) }

    @Test
    fun cardNumberUsesLuhnChecksum() {
        assertTrue(PaymentValidation.isValidCardNumber("4242424242424242"))
        assertTrue(PaymentValidation.isValidCardNumber("4111 1111 1111 1111"))
        assertFalse(PaymentValidation.isValidCardNumber("4242424242424241"))
        assertFalse(PaymentValidation.isValidCardNumber("1234"))
        assertFalse(PaymentValidation.isValidCardNumber("4242abcd42424242"))
    }

    @Test
    fun expiryMustBeThisMonthOrLater() {
        assertTrue(PaymentValidation.isValidExpiry("10/26", october2026))
        assertTrue(PaymentValidation.isValidExpiry("01/30", october2026))
        assertFalse(PaymentValidation.isValidExpiry("09/26", october2026))
        assertFalse(PaymentValidation.isValidExpiry("13/30", october2026))
        assertFalse(PaymentValidation.isValidExpiry("1230", october2026))
    }

    @Test
    fun cvvIsThreeOrFourDigits() {
        assertTrue(PaymentValidation.isValidCvv("123"))
        assertTrue(PaymentValidation.isValidCvv("1234"))
        assertFalse(PaymentValidation.isValidCvv("12"))
        assertFalse(PaymentValidation.isValidCvv("12a"))
    }
}
