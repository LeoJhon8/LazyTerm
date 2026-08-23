package com.lazyterm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner

class SshForegroundService : Service(), DefaultLifecycleObserver {
  companion object {
    const val ACTION_START_OR_UPDATE = "com.lazyterm.action.START_OR_UPDATE_SSH_SERVICE"
    const val EXTRA_ACTIVE_SESSIONS = "active_sessions"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"

    private const val CHANNEL_ID = "lazyterm_ssh_sessions"
    private const val NOTIFICATION_ID = 3201
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private var hasActiveSessions = false

  override fun onCreate() {
    super<Service>.onCreate()
    createNotificationChannel()
    ProcessLifecycleOwner.get().lifecycle.addObserver(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val activeSessions = intent?.getIntExtra(EXTRA_ACTIVE_SESSIONS, 0) ?: 0
    if (intent?.action != ACTION_START_OR_UPDATE || activeSessions <= 0) {
      hasActiveSessions = false
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }

    hasActiveSessions = true
    if (!ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
      ensureWakeLock()
    }
    val title = intent.getStringExtra(EXTRA_TITLE)?.takeIf { it.isNotBlank() } ?: "LazyTerm"
    val text = intent.getStringExtra(EXTRA_TEXT)?.takeIf { it.isNotBlank() }
      ?: resources.getQuantityString(R.plurals.ssh_active_sessions, activeSessions, activeSessions)
    startForeground(NOTIFICATION_ID, buildNotification(title, text))
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    ProcessLifecycleOwner.get().lifecycle.removeObserver(this)
    releaseWakeLock()
    super<Service>.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStart(owner: LifecycleOwner) {
    releaseWakeLock()
  }

  override fun onStop(owner: LifecycleOwner) {
    if (hasActiveSessions) {
      ensureWakeLock()
    }
  }

  private fun ensureWakeLock() {
    if (wakeLock?.isHeld == true) return
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = powerManager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "LazyTerm:SshSession",
    ).apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun releaseWakeLock() {
    wakeLock?.takeIf { it.isHeld }?.release()
    wakeLock = null
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(
      CHANNEL_ID,
      getString(R.string.ssh_service_channel_name),
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = getString(R.string.ssh_service_channel_description)
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(title: String, text: String): Notification {
    val openAppIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      openAppIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_terminal_notification)
      .setContentTitle(title)
      .setContentText(text)
      .setContentIntent(pendingIntent)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .setShowWhen(false)
      .build()
  }
}
