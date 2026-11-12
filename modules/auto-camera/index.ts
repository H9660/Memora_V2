import { requireOptionalNativeModule } from 'expo';

export type CameraLens = 'back' | 'front';

export interface AutoCameraNativeStatus {
  running: boolean;
  intervalSeconds: number;
  lens: CameraLens;
  sessionCount: number;
  totalCount: number;
  /** Epoch millis of the last saved photo. */
  lastCaptureAt: number | null;
  lastError: string | null;
}

interface AutoCameraNativeModule {
  start(intervalSeconds: number, lens: CameraLens): Promise<void>;
  stop(): Promise<void>;
  getStatus(): AutoCameraNativeStatus;
  isIgnoringBatteryOptimizations(): boolean;
  openBatteryOptimizationSettings(): void;
}

/** Null on platforms/builds without the native module (e.g. iOS, Expo Go, web). */
export const AutoCameraNative = requireOptionalNativeModule<AutoCameraNativeModule>('AutoCamera');
