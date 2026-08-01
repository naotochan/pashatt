import { useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { AnnotationColor, Tool } from "../../types/annotation";
import { effectiveSizeFromBrush, previewShape } from "../../lib/brushSize";
import { useLocalization } from "../../lib/localization";

/** プレビュー板の一辺。ここに収まらない実効サイズは縮小して倍率を出す */
const PLATE = 88;
const SWATCH_MAX = 72;
/** "Aa" は font-size より横に広がるので、板からはみ出さないよう控えめに取る */
const TEXT_SWATCH_MAX = 48;
/** 板と同系色の描画色でも輪郭が出るよう、スウォッチに白黒の細リングを回す */
const SWATCH_RING = "0 0 0 1px rgba(0,0,0,0.45), 0 0 0 2px rgba(255,255,255,0.35)";
/** ポップオーバーの概算幅（板 + p-3 の左右 + 枠線）。端でのクランプにだけ使う */
const POPOVER_WIDTH = PLATE + 26;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/** 形状ごとのスウォッチ上限。ここに収まらなければ縮小して倍率を出す */
function swatchMax(shape: ReturnType<typeof previewShape>): number {
  return shape === "text" ? TEXT_SWATCH_MAX : SWATCH_MAX;
}

/**
 * ツールバー行は `overflow-x: auto` なので子要素の絶対配置は縦にクリップされる。
 * body へポータルし、アンカーの実座標から fixed で置く。
 */
function useAnchorPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  /** 実効サイズの桁が増えるとアンカー幅が変わるので、開いたまま測り直す */
  remeasureKey: unknown
) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const half = POPOVER_WIDTH / 2;
      setPos({
        left: clamp(r.left + r.width / 2, half + 8, window.innerWidth - half - 8),
        top: r.bottom + 10,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, open, remeasureKey]);

  return pos;
}

/** 実描画に形を合わせたスウォッチ。plate に収まらなければ縮小する */
function Swatch({
  tool,
  color,
  effective,
  scale,
}: {
  tool: Tool;
  color: AnnotationColor;
  effective: number;
  scale: number;
}) {
  const shape = previewShape(tool);
  const shown = Math.max(3, effective * scale);

  if (shape === "text") {
    return (
      <span
        className="font-bold leading-none"
        style={{
          color,
          fontSize: shown,
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        Aa
      </span>
    );
  }

  if (shape === "block") {
    // モザイクは 1 ブロックの粒度が読み取れるよう、板いっぱいにブロックを敷く
    const cell = Math.max(4, shown);
    return (
      <div
        style={{
          width: SWATCH_MAX,
          height: SWATCH_MAX,
          boxShadow: SWATCH_RING,
          backgroundImage: `conic-gradient(
            rgb(var(--tb-text) / 0.34) 0deg 90deg,
            rgb(var(--tb-text) / 0.12) 90deg 180deg,
            rgb(var(--tb-text) / 0.34) 180deg 270deg,
            rgb(var(--tb-text) / 0.12) 270deg 360deg)`,
          backgroundSize: `${cell * 2}px ${cell * 2}px`,
        }}
      />
    );
  }

  const square = shape === "square";
  return (
    <div
      style={{
        width: shown,
        height: shown,
        backgroundColor: color,
        // ハイライタは draw.ts で globalAlpha 0.35。角も落とさない（lineCap "square"）
        opacity: square ? 0.35 : 1,
        borderRadius: square ? 0 : "9999px",
        boxShadow: SWATCH_RING,
      }}
    />
  );
}

interface SizePreviewPopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  tool: Tool;
  size: number;
  color: AnnotationColor;
}

/** スライダー／数値入力の操作中に、実効サイズを実描画の形で見せる */
export function SizePreviewPopover({
  anchorRef,
  open,
  tool,
  size,
  color,
}: SizePreviewPopoverProps) {
  const { t } = useLocalization();
  const effective = effectiveSizeFromBrush(tool, size);
  const pos = useAnchorPosition(anchorRef, open, effective);
  if (!open || !pos) return null;

  const scale = Math.min(1, swatchMax(previewShape(tool)) / effective);
  const scaled = scale < 1;

  return createPortal(
    <div
      className="fixed z-[100] -translate-x-1/2 pointer-events-none"
      style={{ left: pos.left, top: pos.top }}
      aria-hidden
    >
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-tb-border bg-tb-raised/95 p-3 shadow-xl backdrop-blur-md">
        <div
          className="flex items-center justify-center overflow-hidden rounded-xl border border-tb-border/70 bg-tb-canvas"
          style={{ width: PLATE, height: PLATE }}
        >
          <Swatch tool={tool} color={color} effective={effective} scale={scale} />
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-xs font-mono tabular-nums text-tb-text">{effective}px</span>
          {scaled && (
            <span className="text-[10px] text-tb-text-dim">
              {t(`${Math.round(scale * 100)}% of actual size`, `実寸の ${Math.round(scale * 100)}%`)}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
