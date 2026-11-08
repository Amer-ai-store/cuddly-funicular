package com.example

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.example.data.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class DatabaseMigrationTest {

    @Test
    fun migrationFrom9KeepsUsersAndAddsCredentials() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "migration-test.db"
        context.deleteDatabase(name)

        // Build today's schema, then turn it back into version 9 by dropping the table v10 added.
        Room.databaseBuilder(context, AppDatabase::class.java, name).allowMainThreadQueries().build().apply {
            runBlocking { userDao().insertUser(UserEntity(name = "Old", phoneNumber = "0791111111", email = "old@example.com", role = "Customer")) }
            close()
        }
        SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).apply {
            execSQL("DROP TABLE local_credentials")
            version = 9
            close()
        }

        // No destructive fallback here: Room throws if MIGRATION_9_10 does not produce the expected schema.
        val migrated = Room.databaseBuilder(context, AppDatabase::class.java, name)
            .addMigrations(MIGRATION_9_10)
            .allowMainThreadQueries()
            .build()
        runBlocking {
            assertEquals("Old", migrated.userDao().getUserByEmail("old@example.com")?.name)
            LocalAuthBackend(migrated.credentialDao()).register("old@example.com", "secret12")
            assertNotNull(migrated.credentialDao().getCredential("old@example.com"))
        }
        migrated.close()
        context.deleteDatabase(name)
    }
}
