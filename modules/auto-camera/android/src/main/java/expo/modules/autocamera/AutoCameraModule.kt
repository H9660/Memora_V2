package expo.modules.autocamera

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AutoCameraModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AutoCamera")

    /** Starts interval capture. Must be called while the app is in the foreground. */
    AsyncFunction("start") { intervalSeconds: Int, lens: String ->
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
        throw CodedException("ERR_CAMERA_PERMISSION", "Camera permission is required.", null)
      }
      val intent = Intent(context, AutoCaptureService::class.java)
        .setAction(AutoCaptureService.ACTION_START)
        .putExtra(AutoCaptureService.EXTRA_INTERVAL_SECONDS, intervalSeconds)
        .putExtra(AutoCaptureService.EXTRA_LENS, lens)
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (error: Exception) {
        throw CodedException("ERR_START_FAILED", "Couldn't start auto camera: ${error.message}", error)
      }
    }

    AsyncFunction("stop") {
      context.stopService(Intent(context, AutoCaptureService::class.java))
    }

    Function("getStatus") {
      val state = AutoCameraState.read(context)
      mapOf(
        "running" to AutoCaptureService.isRunning,
        "intervalSeconds" to state.intervalSeconds,
        "lens" to state.lens,
        "sessionCount" to state.sessionCount,
        "totalCount" to state.totalCount,
        "lastCaptureAt" to state.lastCaptureAt?.toDouble(),
        "lastError" to state.lastError,
      )
    }

    Function("isIgnoringBatteryOptimizations") {
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      power.isIgnoringBatteryOptimizations(context.packageName)
    }

    Function("openBatteryOptimizationSettings") {
      context.startActivity(
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }
  }
}
