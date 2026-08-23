package com.lazyterm

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class InstallApkArgs {
  lateinit var path: String
}

@TauriPlugin
class AndroidUpdaterPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun installApk(invoke: Invoke) {
    try {
      val apk = validatedApk(invoke)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        && !activity.packageManager.canRequestPackageInstalls()
      ) {
        val settingsIntent = Intent(
          Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:${activity.packageName}"),
        )
        startActivityForResult(invoke, settingsIntent, "unknownSourcesResult")
        return
      }
      openPackageInstaller(invoke, apk)
    } catch (exception: Exception) {
      invoke.reject(exception.message ?: "Failed to request APK installation")
    }
  }

  @ActivityCallback
  @Suppress("UNUSED_PARAMETER")
  fun unknownSourcesResult(invoke: Invoke, _result: ActivityResult) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
      && !activity.packageManager.canRequestPackageInstalls()
    ) {
      invoke.reject("Install permission was not granted")
      return
    }

    try {
      openPackageInstaller(invoke, validatedApk(invoke))
    } catch (exception: Exception) {
      invoke.reject(exception.message ?: "Failed to open the package installer")
    }
  }

  @ActivityCallback
  fun packageInstallerResult(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode == Activity.RESULT_CANCELED) {
      invoke.reject("Installation was cancelled")
    } else {
      invoke.resolve()
    }
  }

  private fun validatedApk(invoke: Invoke): File {
    val args = invoke.parseArgs(InstallApkArgs::class.java)
    val updatesDirectory = File(activity.cacheDir, "updates").canonicalFile
    val apk = File(args.path).canonicalFile

    if (!apk.path.startsWith(updatesDirectory.path + File.separator)) {
      throw IllegalArgumentException("The APK is outside the update cache")
    }
    if (!apk.isFile || apk.length() == 0L || apk.extension.lowercase() != "apk") {
      throw IllegalArgumentException("The downloaded APK is invalid")
    }

    val packageManager = activity.packageManager
    val archiveInfo = getArchivePackageInfo(packageManager, apk)
      ?: throw IllegalArgumentException("Unable to read the downloaded APK")
    val installedInfo = getInstalledPackageInfo(packageManager)

    if (archiveInfo.packageName != activity.packageName) {
      throw IllegalArgumentException("The APK package name does not match ${activity.packageName}")
    }
    if (PackageInfoCompat.getLongVersionCode(archiveInfo)
      <= PackageInfoCompat.getLongVersionCode(installedInfo)
    ) {
      throw IllegalArgumentException("The downloaded APK is not newer than the installed version")
    }

    val archiveSigners = signerCertificates(archiveInfo)
    val installedSigners = signerCertificates(installedInfo)
    if (archiveSigners.isEmpty() || installedSigners.isEmpty()
      || archiveSigners.intersect(installedSigners).isEmpty()
    ) {
      throw SecurityException("The APK signing certificate does not match the installed app")
    }

    return apk
  }

  private fun openPackageInstaller(invoke: Invoke, apk: File) {
    val uri = FileProvider.getUriForFile(
      activity,
      "${activity.packageName}.fileprovider",
      apk,
    )
    val installIntent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, "application/vnd.android.package-archive")
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      putExtra(Intent.EXTRA_RETURN_RESULT, true)
    }
    startActivityForResult(invoke, installIntent, "packageInstallerResult")
  }

  @Suppress("DEPRECATION")
  private fun getArchivePackageInfo(packageManager: PackageManager, apk: File): PackageInfo? {
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      PackageManager.GET_SIGNATURES
    }
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.getPackageArchiveInfo(
        apk.path,
        PackageManager.PackageInfoFlags.of(flags.toLong()),
      )
    } else {
      packageManager.getPackageArchiveInfo(apk.path, flags)
    }
  }

  @Suppress("DEPRECATION")
  private fun getInstalledPackageInfo(packageManager: PackageManager): PackageInfo {
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      PackageManager.GET_SIGNATURES
    }
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.getPackageInfo(
        activity.packageName,
        PackageManager.PackageInfoFlags.of(flags.toLong()),
      )
    } else {
      packageManager.getPackageInfo(activity.packageName, flags)
    }
  }

  @Suppress("DEPRECATION")
  private fun signerCertificates(packageInfo: PackageInfo): Set<String> {
    val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val signingInfo = packageInfo.signingInfo ?: return emptySet()
      if (signingInfo.hasMultipleSigners()) {
        signingInfo.apkContentsSigners
      } else {
        signingInfo.signingCertificateHistory
      }
    } else {
      packageInfo.signatures
    }
    return signatures
      ?.map { signature -> Base64.encodeToString(signature.toByteArray(), Base64.NO_WRAP) }
      ?.toSet()
      ?: emptySet()
  }
}
