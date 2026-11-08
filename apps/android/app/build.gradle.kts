plugins { id("com.android.application") }

// The app opens this HTTPS address in Chrome as a Trusted Web Activity. Google sign-in works there
// (it is blocked inside plain WebViews), and company data stays behind Firestore rules.
val launchHost = "amer-ai-store.github.io"
val launchUrl = "https://$launchHost/Mohammad-Ahmed-Ghannam/one/"

android {
  namespace = "ai.jawafa.one"
  compileSdk = 35
  defaultConfig {
    applicationId = "ai.jawafa.one"
    minSdk = 26
    targetSdk = 35
    versionCode = (System.getenv("JAWAFA_VERSION_CODE") ?: "1").toInt()
    versionName = "0.1.0"
    resValue("string", "launchUrl", launchUrl)
    resValue("string", "hostName", launchHost)
  }
  // Release signing comes from environment variables set by CI from repository secrets
  // (see scripts/make-android-keystore.sh). The keystore is never committed.
  val ksFile = System.getenv("JAWAFA_KEYSTORE_FILE")
  if (ksFile != null && file(ksFile).exists()) {
    signingConfigs {
      create("release") {
        storeFile = file(ksFile)
        storePassword = System.getenv("JAWAFA_KEYSTORE_PASSWORD")
        keyAlias = System.getenv("JAWAFA_KEY_ALIAS")
        keyPassword = System.getenv("JAWAFA_KEY_PASSWORD")
      }
    }
  }
  buildTypes {
    release {
      isMinifyEnabled = false
      signingConfig = signingConfigs.findByName("release")
    }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

dependencies {
  implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.5.0")
}
