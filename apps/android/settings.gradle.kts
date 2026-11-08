// Standalone build for the JAWAFA ONE AI Android app (Trusted Web Activity).
// Kept separate from the root Gradle build so the existing Android store app is unaffected.
pluginManagement {
  repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories { google(); mavenCentral() }
}
rootProject.name = "jawafa-one-android"
include(":app")
