package com.example.ui

import java.util.Calendar

/** Client-side checks for the "link a card" form. They catch typos; they do not authorize a card. */
object PaymentValidation {

    /** Luhn checksum over a 13-19 digit card number (spaces and dashes ignored). */
    fun isValidCardNumber(input: String): Boolean {
        val digits = input.filterNot { it == ' ' || it == '-' }
        if (digits.length !in 13..19 || !digits.all { it.isDigit() }) return false
        var sum = 0
        digits.reversed().forEachIndexed { index, c ->
            var d = c - '0'
            if (index % 2 == 1) {
                d *= 2
                if (d > 9) d -= 9
            }
            sum += d
        }
        return sum % 10 == 0
    }

    /** Accepts MM/YY for the current month or later. */
    fun isValidExpiry(input: String, now: Calendar = Calendar.getInstance()): Boolean {
        val match = Regex("""^(\d{2})/(\d{2})$""").matchEntire(input.trim()) ?: return false
        val month = match.groupValues[1].toInt()
        val year = 2000 + match.groupValues[2].toInt()
        if (month !in 1..12) return false
        val currentYear = now.get(Calendar.YEAR)
        val currentMonth = now.get(Calendar.MONTH) + 1
        return year > currentYear || (year == currentYear && month >= currentMonth)
    }

    fun isValidCvv(input: String): Boolean = input.length in 3..4 && input.all { it.isDigit() }
}
