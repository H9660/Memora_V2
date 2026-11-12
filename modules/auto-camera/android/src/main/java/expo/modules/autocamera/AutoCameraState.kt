package expo.modules.autocamera

import android.content.Context

/** Small persisted status shared between the service, its notification and JS. */
object AutoCameraState {
  private const val PREFS = "memora_auto_camera"

  data class Snapshot(
    val intervalSeconds: Int,
    val lens: String,
    val sessionCount: Int,
    val totalCount: Int,
    val lastCaptureAt: Long?,
    val startedAt: Long?,
    val lastError: String?,
  )

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun read(context: Context): Snapshot {
    val p = prefs(context)
    return Snapshot(
      intervalSeconds = p.getInt("intervalSeconds", 300),
      lens = p.getString("lens", "back") ?: "back",
      sessionCount = p.getInt("sessionCount", 0),
      totalCount = p.getInt("totalCount", 0),
      lastCaptureAt = p.getLong("lastCaptureAt", 0L).takeIf { it > 0 },
      startedAt = p.getLong("startedAt", 0L).takeIf { it > 0 },
      lastError = p.getString("lastError", null),
    )
  }

  fun recordStart(context: Context, intervalSeconds: Int, lens: String) {
    prefs(context).edit()
      .putInt("intervalSeconds", intervalSeconds)
      .putString("lens", lens)
      .putInt("sessionCount", 0)
      .putLong("startedAt", System.currentTimeMillis())
      .remove("lastError")
      .apply()
  }

  fun recordCapture(context: Context, takenAt: Long) {
    val p = prefs(context)
    p.edit()
      .putInt("sessionCount", p.getInt("sessionCount", 0) + 1)
      .putInt("totalCount", p.getInt("totalCount", 0) + 1)
      .putLong("lastCaptureAt", takenAt)
      .remove("lastError")
      .apply()
  }

  fun recordError(context: Context, message: String) {
    prefs(context).edit().putString("lastError", message).apply()
  }

  fun recordStop(context: Context) {
    prefs(context).edit().remove("startedAt").apply()
  }
}
