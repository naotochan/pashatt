import { useCallback, useEffect, useRef, useState } from "react";
import type { AnnotationColor, Tool } from "../../types/annotation";
import {
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
  effectiveSizeFromBrush,
  isSizeInPixels,
  sizeControlLabel,
} from "../../lib/brushSize";
import { SizePreviewPopover } from "./SizePreviewPopover";
import { useLocalization } from "../../lib/localization";

interface SizeControlProps {
  tool: Tool;
  size: number;
  color: AnnotationColor;
  onChange: (s: number) => void;
}

/** キーボード操作にはポインタと違い「離した」瞬間がないので時間で閉じる */
const KEYBOARD_PREVIEW_MS = 1200;

/** これ以外のキー（Tab や修飾キー単独）でプレビューを開かない */
const ADJUST_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

type PreviewSource = "slider" | "field" | null;

export function SizeControl({ tool, size, color, onChange }: SizeControlProps) {
  const { t } = useLocalization();
  const groupRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number>(0);
  const [source, setSource] = useState<PreviewSource>(null);

  const effective = effectiveSizeFromBrush(tool, size);
  const inPixels = isSizeInPixels(tool);
  const label = sizeControlLabel(tool, t);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = 0;
    }
  }, []);

  /**
   * ドラッグ中は押している間だけ、キーボード操作は一定時間だけ出す。
   * keydown の直後に change も飛ぶので、モードは ref に持って change 側で上書きしない。
   */
  const modeRef = useRef<"pointer" | "keyboard">("pointer");
  const openFromSlider = useCallback(
    (mode: "pointer" | "keyboard") => {
      modeRef.current = mode;
      clearTimer();
      setSource("slider");
      if (mode === "keyboard") {
        timerRef.current = window.setTimeout(
          () => setSource((s) => (s === "slider" ? null : s)),
          KEYBOARD_PREVIEW_MS
        );
      }
    },
    [clearTimer]
  );

  // スライダーを離した／ウィンドウが背面に回ったら閉じる。
  // 数値入力にフォーカスがある間は pointerup で閉じない（クリック直後に消えてしまう）
  useEffect(() => {
    if (source !== "slider") return;
    const end = () => {
      clearTimer();
      setSource(null);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("blur", end);
    };
  }, [source, clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  const commit = (raw: number) =>
    onChange(Math.max(BRUSH_SIZE_MIN, Math.min(BRUSH_SIZE_MAX, raw || BRUSH_SIZE_MIN)));

  return (
    <div ref={groupRef} className="tool-group">
      <span className="px-1 text-[11px] font-medium tracking-wide text-tb-text-sub whitespace-nowrap">
        {label}
      </span>
      <input
        type="range"
        min={BRUSH_SIZE_MIN}
        max={BRUSH_SIZE_MAX}
        value={size}
        onPointerDown={() => openFromSlider("pointer")}
        onKeyDown={(e) => {
          if (ADJUST_KEYS.has(e.key)) openFromSlider("keyboard");
        }}
        onChange={(e) => {
          // すでに開いているなら閉じ方（pointerup 待ち／タイマー）を維持する
          if (source === null) openFromSlider(modeRef.current);
          onChange(Number(e.target.value));
        }}
        className="slider-tb w-24"
        aria-label={label}
        aria-valuetext={`${effective}px`}
      />
      <div className="flex items-center gap-0.5">
        <input
          type="number"
          min={BRUSH_SIZE_MIN}
          max={BRUSH_SIZE_MAX}
          value={size}
          onFocus={() => {
            clearTimer();
            setSource("field");
          }}
          // スライダーへ直接ドラッグすると pointerdown の後に blur が来る。
          // すでにスライダー操作へ移っている場合は閉じない
          onBlur={() => setSource((s) => (s === "field" ? null : s))}
          onChange={(e) => commit(Number(e.target.value))}
          className="w-10 bg-tb-base text-tb-text text-[11px] font-mono tabular-nums text-center rounded-md border border-tb-border px-1 py-0.5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          aria-label={t(`${label} value`, `${label}の数値`)}
        />
        {/* スライダー値がそのまま px のときだけ px を名乗る。
            それ以外は倍率なので、実効サイズを唯一の px 表示にする */}
        {inPixels ? (
          <span className="text-[11px] font-mono text-tb-text-dim">px</span>
        ) : (
          <span
            className="ml-0.5 text-[11px] font-mono tabular-nums text-tb-text-sub whitespace-nowrap"
            title={t("Actual draw size", "実際の描画サイズ")}
          >
            {effective}px
          </span>
        )}
      </div>
      <SizePreviewPopover
        anchorRef={groupRef}
        open={source !== null}
        tool={tool}
        size={size}
        color={color}
      />
    </div>
  );
}
