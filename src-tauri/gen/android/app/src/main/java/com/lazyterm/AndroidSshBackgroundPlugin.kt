package com.lazyterm

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class ActiveSshSessionArgs {
  var activeSessions: Int = 0
  var title: String = "LazyTerm"
  var text: String = ""
}

@TauriPlugin
class AndroidSshBackgroundPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun setActiveSessionCount(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ActiveSshSessionArgs::class.java)
      if (args.activeSessions > 0) {
        val intent = Intent(activity, SshForegroundService::class.java).apply {
          action = SshForegroundService.ACTION_START_OR_UPDATE
          putExtra(SshForegroundService.EXTRA_ACTIVE_SESSIONS, args.activeSessions)
          putExtra(SshForegroundService.EXTRA_TITLE, args.title)
          putExtra(SshForegroundService.EXTRA_TEXT, args.text)
        }
        ContextCompat.startForegroundService(activity, intent)
      } else {
        activity.stopService(Intent(activity, SshForegroundService::class.java))
      }
      invoke.resolve()
    } catch (exception: Exception) {
      invoke.reject(exception.message ?: "Failed to update the SSH background service")
    }
  }

  @Command
  fun openAppSettings(invoke: Invoke) {
    try {
      val intent = Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.parse("package:${activity.packageName}"),
      ).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(intent)
      invoke.resolve()
    } catch (exception: Exception) {
      invoke.reject(exception.message ?: "Failed to open Android app settings")
    }
  }
}
