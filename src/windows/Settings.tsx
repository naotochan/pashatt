import { useEffect, useMemo, useState } from "react";
import {
  getSettings,
  saveSettings,
  checkScreenPermission,
  checkAccessibilityPermission,
  openSystemPreferences,
  openAccessibilityPreferences,
  checkForUpdates,
  type AppSettings,
} from "../lib/ipc";
import { DEFAULT_SETTINGS } from "../lib/AppChromeProvider";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import {
  useLocalization,
  type AppLanguage,
} from "../lib/localization";
import {
  APP_APPEARANCES,
  appearanceLabel,
  useAppearance,
  type AppAppearance,
} from "../lib/appearance";
import {
  DEFAULT_SCREENSHOT_HOTKEY,
  formatHotkeyMac,
  normalizeHotkeyAccelerator,
} from "../lib/hotkeyFormat";

type SettingsCategory = "general" | "permissions" | "shortcuts" | "save";

const CATEGORIES: SettingsCategory[] = ["general", "permissions", "shortcuts", "save"];

/** EN/JA keywords for sidebar search (guideline). */
function categorySearchBlob(id: SettingsCategory): string {
  switch (id) {
    case "general":
      return "appearance theme language update 外観 テーマ 言語 アップデート 更新 system light dark english japanese";
    case "permissions":
      return "permissions screen recording accessibility 権限 スクリーン録画 アクセシビリティ";
    case "shortcuts":
      return "shortcuts hotkey keyboard ショートカット ホットキー キーボード screenshot";
    case "save":
      return "save folder format cursor 保存 フォルダ 形式 カーソル png jpeg desktop";
  }
}

export default function Settings() {
  const { language, setLanguage, resolved, t } = useLocalization();
  const { appearance, setAppearance } = useAppearance();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [hasAccessibility, setHasAccessibility] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);
  const [category, setCategory] = useState<SettingsCategory>("general");
  const [searchText, setSearchText] = useState("");
  const [appVersion, setAppVersion] = useState("");

  const chromeKey = `${language}-${appearance}`;

  const categoryTitle = (id: SettingsCategory) => {
    switch (id) {
      case "general":
        return t("General", "一般");
      case "permissions":
        return t("Permissions", "権限");
      case "shortcuts":
        return t("Shortcuts", "ショートカット");
      case "save":
        return t("Save", "保存");
    }
  };

  const filteredCategories = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return CATEGORIES;
    return CATEGORIES.filter(
      (id) =>
        categoryTitle(id).toLowerCase().includes(q) ||
        categorySearchBlob(id).toLowerCase().includes(q)
    );
  }, [searchText, language, t]);

  useEffect(() => {
    // If filter hides current selection, jump to first match
    if (filteredCategories.length > 0 && !filteredCategories.includes(category)) {
      setCategory(filteredCategories[0]);
    }
  }, [filteredCategories, category]);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | null = null;
    win
      .onCloseRequested((event) => {
        event.preventDefault();
        win.hide();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(""));
    getSettings()
      .then((s) =>
        setSettings({
          ...DEFAULT_SETTINGS,
          ...s,
          app_language: (s.app_language as AppLanguage) || "system",
          app_appearance: (s.app_appearance as AppAppearance) || "system",
        })
      )
      .catch(console.error);
    checkScreenPermission()
      .then(setHasPermission)
      .catch(() => setHasPermission(false));
    checkAccessibilityPermission()
      .then(setHasAccessibility)
      .catch(() => setHasAccessibility(false));
  }, []);

  const handleSave = async () => {
    const next: AppSettings = {
      ...settings,
      hotkeys: {
        ...settings.hotkeys,
        screenshot: normalizeHotkeyAccelerator(settings.hotkeys.screenshot),
      },
      app_language: language,
      app_appearance: appearance,
    };
    await saveSettings(next);
    setSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClose = async () => {
    await getCurrentWindow().hide();
  };

  const needsPersistFooter = category === "shortcuts" || category === "save";

  return (
    <div key={chromeKey} className="flex flex-col h-screen bg-tb-base select-none">
      {/* Two-pane body (native title bar already shows the app name) */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-[200px] shrink-0 flex flex-col bg-tb-raised border-r border-tb-border">
          <div className="px-3 pt-3.5 pb-2.5">
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={t("Search Settings", "設定を検索")}
              aria-label={t("Search Settings", "設定を検索")}
              autoComplete="off"
              spellCheck={false}
              className="w-full px-2.5 py-1.5 rounded-lg border border-tb-border bg-tb-base text-sm text-tb-text placeholder:text-tb-text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-tb-selected/25"
            />
          </div>
          <nav className="px-2 flex flex-col gap-0.5" aria-label={t("Settings", "設定")}>
            {filteredCategories.map((id) => {
              const selected = category === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCategory(id)}
                  aria-current={selected ? "page" : undefined}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                    selected
                      ? "bg-tb-selected/14 text-tb-text font-medium"
                      : "text-tb-text-sub hover:bg-tb-hover hover:text-tb-text"
                  }`}
                >
                  {categoryTitle(id)}
                </button>
              );
            })}
            {filteredCategories.length === 0 && (
              <p className="px-2.5 py-2 text-xs text-tb-text-dim">
                {t("No matches", "一致なし")}
              </p>
            )}
          </nav>
        </aside>

        {/* Detail pane */}
        <main className="flex-1 min-w-0 flex flex-col bg-tb-base">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <h2 className="text-lg font-semibold text-tb-text text-pretty">
              {categoryTitle(category)}
            </h2>

            {category === "general" && (
              <>
              <Section title={t("Appearance", "外観")}>
                <SettingRow
                  title={t("Theme", "テーマ")}
                  subtitle={t(
                    "Applies immediately to the whole window.",
                    "ウィンドウ全体にすぐ反映されます。"
                  )}
                >
                  <SegmentedControl
                    ariaLabel={t("Theme", "テーマ")}
                    value={appearance}
                    options={APP_APPEARANCES.map((mode) => ({
                      value: mode,
                      label: appearanceLabel(mode, resolved),
                    }))}
                    onChange={(v) => setAppearance(v as AppAppearance)}
                  />
                </SettingRow>
                <RowSeparator />
                <SettingRow
                  title={t("Language", "言語")}
                  subtitle={t(
                    "Applies immediately to menus and on-screen text.",
                    "メニューや画面上の文言にすぐ反映されます。"
                  )}
                >
                  <SegmentedControl
                    ariaLabel="Language / 言語"
                    value={language}
                    options={[
                      { value: "system", label: t("System", "システム") },
                      { value: "english", label: "English" },
                      { value: "japanese", label: "日本語" },
                    ]}
                    onChange={(v) => setLanguage(v as AppLanguage)}
                  />
                </SettingRow>
              </Section>
              <Section title={t("Updates", "アップデート")}>
                <SettingRow
                  title={t("Version", "バージョン")}
                  subtitle={appVersion ? `Pashatt ${appVersion}` : "Pashatt"}
                >
                  <button
                    type="button"
                    onClick={() => {
                      void checkForUpdates();
                    }}
                    className="px-3 py-1.5 rounded-lg text-sm bg-tb-raised border border-tb-border text-tb-text hover:bg-tb-hover transition-colors"
                  >
                    Check for Updates…
                  </button>
                </SettingRow>
              </Section>
              </>
            )}

            {category === "permissions" && (
              <Section title={t("Permissions", "権限")}>
                <SettingRow
                  title={t("Screen Recording", "スクリーン録画")}
                  subtitle={t("Required for capture.", "キャプチャに必要な権限です")}
                >
                  <PermissionBadge
                    state={hasPermission}
                    t={t}
                    onGrant={() => openSystemPreferences()}
                    tone="blue"
                  />
                </SettingRow>
                <RowSeparator />
                <SettingRow
                  title={t("Accessibility", "アクセシビリティ")}
                  subtitle={t(
                    "Required for the global hotkey.",
                    "グローバルホットキーに必要な権限です"
                  )}
                >
                  <PermissionBadge
                    state={hasAccessibility}
                    t={t}
                    onGrant={() => openAccessibilityPreferences()}
                    tone="orange"
                  />
                </SettingRow>
              </Section>
            )}

            {category === "shortcuts" && (
              <Section title={t("Global Hotkey", "グローバルホットキー")}>
                <SettingRow
                  title={t("Screenshot", "スクリーンショット")}
                  subtitle={t(
                    "Default is ⌘⇧Space. You can change it below.",
                    "標準は ⌘⇧Space。下で変更できます。"
                  )}
                >
                  <span
                    className="text-sm font-medium text-tb-text tabular-nums tracking-wide px-2.5 py-1 rounded-lg bg-tb-base border border-tb-border"
                    translate="no"
                  >
                    {formatHotkeyMac(settings.hotkeys.screenshot || DEFAULT_SCREENSHOT_HOTKEY)}
                  </span>
                </SettingRow>
                <RowSeparator />
                <div className="py-2.5 space-y-2">
                  <label className="text-sm text-tb-text" htmlFor="hotkey_screenshot">
                    {t("Customize", "カスタマイズ")}
                  </label>
                  <input
                    id="hotkey_screenshot"
                    name="hotkey_screenshot"
                    autoComplete="off"
                    spellCheck={false}
                    translate="no"
                    aria-label={t("Screenshot hotkey", "スクリーンショットのショートカット")}
                    className="w-full px-3 py-2 rounded-lg border border-tb-border text-sm font-mono text-tb-text focus:outline-none focus-visible:ring-2 focus-visible:ring-tb-selected/25 bg-tb-base placeholder:text-tb-text-dim"
                    value={settings.hotkeys.screenshot}
                    placeholder={DEFAULT_SCREENSHOT_HOTKEY}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        hotkeys: { ...s.hotkeys, screenshot: e.target.value },
                      }))
                    }
                    onBlur={(e) => {
                      const next = normalizeHotkeyAccelerator(e.target.value);
                      setSettings((s) => ({
                        ...s,
                        hotkeys: { ...s.hotkeys, screenshot: next },
                      }));
                    }}
                  />
                  <p className="text-xs text-tb-text-dim">
                    {t(
                      "Example: ⌘⇧Space, ⌥1, Command+Shift+4",
                      "例: ⌘⇧Space、⌥1、Command+Shift+4"
                    )}
                  </p>
                </div>
              </Section>
            )}

            {category === "save" && (
              <Section title={t("Save", "保存設定")}>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-tb-text" htmlFor="save-directory">
                      {t("Default Save Folder", "デフォルト保存先")}
                    </label>
                    <input
                      id="save-directory"
                      name="save_directory"
                      autoComplete="off"
                      spellCheck={false}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-tb-border text-sm text-tb-text focus:outline-none focus-visible:ring-2 focus-visible:ring-tb-selected/25 bg-tb-base placeholder:text-tb-text-dim"
                      value={settings.save_directory}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, save_directory: e.target.value }))
                      }
                      placeholder="~/Desktop"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-tb-text" htmlFor="image-format">
                      {t("Image Format", "画像形式")}
                    </label>
                    <select
                      id="image-format"
                      name="image_format"
                      autoComplete="off"
                      className="settings-select mt-1 w-full"
                      value={settings.image_format}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          image_format: e.target.value as "png" | "jpeg",
                        }))
                      }
                    >
                      <option value="png">PNG</option>
                      <option value="jpeg">JPEG</option>
                    </select>
                  </div>
                  <RowSeparator />
                  <SettingRow
                    title={t("Include Cursor", "カーソルを含める")}
                    subtitle={t(
                      "Show the mouse cursor in screenshots.",
                      "スクリーンショットにマウスカーソルを表示します"
                    )}
                  >
                    <button
                      className="toggle-switch"
                      role="switch"
                      aria-checked={settings.show_cursor}
                      aria-label={t("Include Cursor", "カーソルを含める")}
                      data-on={settings.show_cursor ? "true" : "false"}
                      onClick={() =>
                        setSettings((s) => ({ ...s, show_cursor: !s.show_cursor }))
                      }
                    />
                  </SettingRow>
                </div>
              </Section>
            )}
          </div>

          <div className="px-6 py-3.5 border-t border-tb-border bg-tb-base flex items-center justify-end gap-3 shrink-0">
            <button
              onClick={handleClose}
              className="px-4 py-2 rounded-lg text-sm text-tb-text-sub hover:bg-tb-hover hover:text-tb-text transition-colors"
            >
              {needsPersistFooter ? t("Cancel", "キャンセル") : t("Close", "閉じる")}
            </button>
            {needsPersistFooter && (
              <button
                onClick={handleSave}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-tb-base bg-tb-text hover:opacity-90 transition-opacity"
              >
                {saved ? t("Saved ✓", "保存しました ✓") : t("Save", "保存")}
              </button>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-tb-text-sub uppercase tracking-wide mb-2.5">
        {title}
      </h3>
      <div className="bg-tb-raised rounded-xl border border-tb-border px-4 py-3 space-y-0">
        {children}
      </div>
    </div>
  );
}

function SegmentedControl({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center p-0.5 rounded-lg bg-tb-base border border-tb-border"
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              selected
                ? "bg-tb-raised text-tb-text shadow-sm ring-1 ring-tb-border/80"
                : "text-tb-text-sub hover:text-tb-text"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function SettingRow({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-tb-text">{title}</p>
        {subtitle && <p className="text-xs text-tb-text-sub mt-0.5">{subtitle}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function RowSeparator() {
  return <div className="border-t border-tb-border/50" />;
}

function PermissionBadge({
  state,
  t,
  onGrant,
  tone,
}: {
  state: boolean | null;
  t: (en: string, ja: string) => string;
  onGrant: () => void;
  tone: "blue" | "orange";
}) {
  if (state === null) {
    return <span className="text-xs text-tb-text-dim">{t("Checking…", "確認中…")}</span>;
  }
  if (state) {
    return (
      <span className="text-xs font-medium text-tb-success bg-tb-success/15 px-2.5 py-1 rounded-full">
        {t("Granted ✓", "許可済み ✓")}
      </span>
    );
  }
  const cls =
    tone === "blue"
      ? "text-xs font-medium text-tb-base bg-tb-text hover:opacity-90 px-3 py-1.5 rounded-lg transition-opacity"
      : "text-xs font-medium text-tb-warning bg-tb-warning/15 hover:bg-tb-warning/25 px-3 py-1.5 rounded-lg transition-colors";
  return (
    <button type="button" onClick={onGrant} className={cls}>
      {t("Grant Access…", "権限を付与…")}
    </button>
  );
}
