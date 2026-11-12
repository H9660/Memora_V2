package expo.modules.autocamera

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import java.io.File
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Takes one photo every interval while running. Runs as a camera-type foreground
 * service (started while the app is visible), so it keeps working with the screen
 * off. The camera is opened only for each shot and released straight after.
 * Photos are written to <filesDir>/auto-captures/<epochMillis>-<lens>.jpg.
 */
class AutoCaptureService : LifecycleService() {
  companion object {
    const val ACTION_START = "expo.modules.autocamera.START"
    const val ACTION_STOP = "expo.modules.autocamera.STOP"
    const val EXTRA_INTERVAL_SECONDS = "intervalSeconds"
    const val EXTRA_LENS = "lens"
    const val MIN_INTERVAL_SECONDS = 10
    const val MAX_INTERVAL_SECONDS = 86_400

    private const val TAG = "MemoraAutoCamera"
    private const val CHANNEL_ID = "memora-auto-camera"
    private const val NOTIFICATION_ID = 4711
    private const val DIRECTORY = "auto-captures"

    @Volatile
    var isRunning = false
      private set

    fun outputDirectory(context: Context): File = File(context.filesDir, DIRECTORY).apply { mkdirs() }
  }

  private val handler = Handler(Looper.getMainLooper())
  private val executor: ExecutorService = Executors.newSingleThreadExecutor()
  private var wakeLock: PowerManager.WakeLock? = null
  private var cameraProvider: ProcessCameraProvider? = null
  private var intervalMs = 300_000L
  private var lens = "back"
  private var capturing = false

  private val tick = object : Runnable {
    override fun run() {
      capture()
      handler.postDelayed(this, intervalMs)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    super.onStartCommand(intent, flags, startId)

    if (intent?.action != ACTION_START) {
      // ACTION_STOP, or a system restart without our intent: Android doesn't allow
      // restarting camera capture from the background, so just shut down.
      shutdown(null)
      return START_NOT_STICKY
    }

    val seconds = intent.getIntExtra(EXTRA_INTERVAL_SECONDS, 300)
      .coerceIn(MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS)
    intervalMs = seconds * 1000L
    lens = if (intent.getStringExtra(EXTRA_LENS) == "front") "front" else "back"

    try {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        buildNotification(),
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA else 0,
      )
    } catch (error: Exception) {
      // E.g. started while the app wasn't visible, or camera permission missing.
      Log.w(TAG, "Could not start foreground capture", error)
      AutoCameraState.recordError(this, "Android didn't allow the camera to start: ${error.message}")
      shutdown(null)
      return START_NOT_STICKY
    }

    acquireWakeLock()
    isRunning = true
    AutoCameraState.recordStart(this, seconds, lens)

    ProcessCameraProvider.getInstance(this).addListener({
      try {
        cameraProvider = ProcessCameraProvider.getInstance(this).get()
        handler.removeCallbacks(tick)
        handler.post(tick)
      } catch (error: Exception) {
        Log.w(TAG, "Camera unavailable", error)
        shutdown("Camera unavailable: ${error.message}")
      }
    }, ContextCompat.getMainExecutor(this))

    return START_NOT_STICKY
  }

  private fun selectorFor(provider: ProcessCameraProvider): CameraSelector? {
    val preferred = if (lens == "front") CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
    return try {
      if (provider.hasCamera(preferred)) preferred
      else provider.availableCameraInfos.firstOrNull()?.cameraSelector
    } catch (error: Exception) {
      provider.availableCameraInfos.firstOrNull()?.cameraSelector
    }
  }

  private fun capture() {
    val provider = cameraProvider ?: return
    if (capturing) return

    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      shutdown("Camera permission was turned off.")
      return
    }
    val selector = selectorFor(provider)
    if (selector == null) {
      AutoCameraState.recordError(this, "No camera found.")
      return
    }

    val imageCapture = ImageCapture.Builder()
      .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
      .setJpegQuality(82)
      .setResolutionSelector(
        ResolutionSelector.Builder()
          .setResolutionStrategy(
            ResolutionStrategy(Size(1600, 1200), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER),
          )
          .build(),
      )
      .build()

    try {
      provider.unbindAll()
      provider.bindToLifecycle(this, selector, imageCapture)
    } catch (error: Exception) {
      Log.w(TAG, "Could not open camera", error)
      AutoCameraState.recordError(this, "Couldn't open the camera: ${error.message}")
      return
    }

    capturing = true
    val takenAt = System.currentTimeMillis()
    val directory = outputDirectory(this)
    // Write to a hidden temp file, then rename, so readers never see a half-written photo.
    val temp = File(directory, ".$takenAt.tmp")
    val target = File(directory, "$takenAt-$lens.jpg")

    imageCapture.takePicture(
      ImageCapture.OutputFileOptions.Builder(temp).build(),
      executor,
      object : ImageCapture.OnImageSavedCallback {
        override fun onImageSaved(output: ImageCapture.OutputFileResults) {
          val saved = temp.renameTo(target)
          handler.post {
            release(provider)
            if (saved) {
              AutoCameraState.recordCapture(this@AutoCaptureService, takenAt)
              updateNotification()
            } else {
              temp.delete()
              AutoCameraState.recordError(this@AutoCaptureService, "Couldn't save a photo.")
            }
          }
        }

        override fun onError(exception: ImageCaptureException) {
          temp.delete()
          handler.post {
            release(provider)
            Log.w(TAG, "Capture failed", exception)
            AutoCameraState.recordError(this@AutoCaptureService, "A photo failed: ${exception.message}")
          }
        }
      },
    )
  }

  private fun release(provider: ProcessCameraProvider) {
    try {
      provider.unbindAll()
    } catch (_: Exception) {
    }
    capturing = false
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val power = getSystemService(Context.POWER_SERVICE) as PowerManager
    // Keeps the CPU awake (screen can stay off) so the interval timer keeps firing.
    wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "memora:auto-camera").apply {
      setReferenceCounted(false)
      acquire(24 * 60 * 60 * 1000L)
    }
  }

  private fun shutdown(error: String?) {
    if (error != null) AutoCameraState.recordError(this, error)
    handler.removeCallbacks(tick)
    cameraProvider?.let { release(it) }
    isRunning = false
    AutoCameraState.recordStop(this)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    try {
      cameraProvider?.unbindAll()
    } catch (_: Exception) {
    }
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    executor.shutdown()
    isRunning = false
    AutoCameraState.recordStop(this)
    super.onDestroy()
  }

  private fun describeInterval(): String {
    val seconds = intervalMs / 1000
    return when {
      seconds < 60 -> "$seconds sec"
      seconds % 3600 == 0L -> "${seconds / 3600} h"
      seconds % 60 == 0L -> "${seconds / 60} min"
      else -> "${seconds / 60} min ${seconds % 60} sec"
    }
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Auto camera", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while Memora is taking photos automatically"
        },
      )
    }

    val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    val openApp = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, flags)
    }
    val stop = PendingIntent.getService(
      this,
      1,
      Intent(this, AutoCaptureService::class.java).setAction(ACTION_STOP),
      flags,
    )

    val state = AutoCameraState.read(this)
    val last = state.lastCaptureAt?.let { DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it)) }
    val text = buildString {
      append("Taking a photo every ${describeInterval()}")
      if (last != null) append(" · ${state.sessionCount} so far, last at $last")
    }

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_menu_camera)
      .setContentTitle("Memora auto camera is on")
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(openApp)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stop)
      .build()
  }

  private fun updateNotification() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    try {
      manager.notify(NOTIFICATION_ID, buildNotification())
    } catch (_: SecurityException) {
      // Notification permission denied; the service still runs.
    }
  }
}
