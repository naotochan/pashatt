import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type CaptureMode = "region" | "window" | "fullscreen";

export interface CaptureCompletePayload {
  image_base64: string;
  width: number;
  height: number;
}

export type AppLanguageSetting = "system" | "english" | "japanese";
export type AppAppearanceSetting = "system" | "light" | "dark";

export interface AppSettings {
  hotkeys: {
    screenshot: string;
  };
  save_directory: string;
  image_format: "png" | "jpeg";
  show_cursor: boolean;
  favorite_colors: string[];
  app_language: AppLanguageSetting;
  app_appearance: AppAppearanceSetting;
}

export interface WindowInfo {
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ============================================================
// Tauriコマンド呼び出しラッパー
// ============================================================

export const getSettings = (): Promise<AppSettings> =>
  invoke("get_settings");

export const saveSettings = (settings: AppSettings): Promise<void> =>
  invoke("save_settings", { settings });

export const showOverlay = (): Promise<void> => invoke("show_overlay");

export const hideOverlay = (): Promise<void> => invoke("hide_overlay");

export const notifyEditorHidden = (): Promise<void> => invoke("editor_hidden");

export const captureRegion = (
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> => invoke("capture_region", { x, y, width, height });

export const doCaptureFullscreen = (): Promise<void> =>
  invoke("do_capture_fullscreen");

export const getWindowList = (): Promise<WindowInfo[]> =>
  invoke("get_window_list");

export const captureWindowById = (windowId: number): Promise<void> =>
  invoke("capture_window_by_id", { windowId });

export const copyToClipboard = (
  base64Data: string,
  ext: string
): Promise<void> => invoke("copy_to_clipboard", { base64Data, ext });

export const saveImage = (base64Data: string, path: string): Promise<void> =>
  invoke("save_image", { base64Data, path });

export const checkScreenPermission = (): Promise<boolean> =>
  invoke("check_screen_permission");

export const checkAccessibilityPermission = (): Promise<boolean> =>
  invoke("check_accessibility_permission");

export const openSystemPreferences = (): Promise<void> =>
  invoke("open_system_preferences");

export const openAccessibilityPreferences = (): Promise<void> =>
  invoke("open_accessibility_preferences");

export const checkForUpdates = (): Promise<void> =>
  invoke("check_for_updates_cmd");

// ============================================================
// イベントリスナー
// ============================================================

export const onCaptureComplete = (
  cb: (payload: CaptureCompletePayload) => void
): Promise<UnlistenFn> =>
  listen<CaptureCompletePayload>("capture-complete", (e) => cb(e.payload));
