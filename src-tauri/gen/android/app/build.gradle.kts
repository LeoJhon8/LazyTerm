import java.util.Properties
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

val lazyTermVersionName = tauriProperties.getProperty("tauri.android.versionName", "1.0.0")

fun lazyTermAndroidVersionCode(versionName: String): Int {
    val parts = versionName.split('.').map { it.toInt() }
    require(parts.size == 3) { "LazyTerm Android version must use Major.Minor.Patch" }

    val year = 2000 + parts[0]
    val month = parts[1] / 10
    val day = (parts[1] % 10) * 10 + (parts[2] / 1440)
    val minuteOfDay = parts[2] % 1440
    val versionTime = LocalDateTime.of(
        year,
        month,
        day,
        minuteOfDay / 60,
        minuteOfDay % 60,
    )
    val epoch = LocalDateTime.of(2000, 1, 1, 0, 0)
    return 100_000_000 + ChronoUnit.MINUTES.between(epoch, versionTime).toInt()
}

val releaseKeystorePath = System.getenv("LAZYTERM_ANDROID_KEYSTORE_PATH")
val releaseKeystorePassword = System.getenv("LAZYTERM_ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = System.getenv("LAZYTERM_ANDROID_KEY_ALIAS")
val releaseKeyPassword = System.getenv("LAZYTERM_ANDROID_KEY_PASSWORD")
val hasReleaseSigning = listOf(
    releaseKeystorePath,
    releaseKeystorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { !it.isNullOrBlank() }

android {
    compileSdk = 36
    buildToolsVersion = "36.1.0"
    namespace = "com.lazyterm"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.lazyterm"
        minSdk = 24
        targetSdk = 36
        versionCode = lazyTermAndroidVersionCode(lazyTermVersionName)
        versionName = lazyTermVersionName
    }
    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(requireNotNull(releaseKeystorePath))
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
        }
        getByName("release") {
            signingConfigs.findByName("release")?.let { signingConfig = it }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
}

apply(from = "tauri.build.gradle.kts")
