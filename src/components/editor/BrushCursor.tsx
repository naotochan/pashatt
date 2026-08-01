import { forwardRef, useImperativeHandle, useRef } from "react";
import type { AnnotationColor } from "../../types/annotation";
import type { PreviewShape } from "../../lib/brushSize";

export interface BrushCursorHandle {
  /** キャンバス座標へ移動して表示する */
  move(x: number, y: number): void;
  hide(): void;
}

interface BrushCursorProps {
  diameter: number;
  color: AnnotationColor;
  shape: PreviewShape;
  /** 画面上で約 1px の線になるよう 1/displayScale */
  borderWidth: number;
}

/** これ以下（画面 px）なら輪郭だけでは狙えないので中心点を足す */
const TINY_SCREEN_PX = 14;

/**
 * カーソル下のブラシプレビュー。
 *
 * 位置更新は mousemove ごとに起きるので、React state ではなく ref 経由で
 * transform を直接書き換える（Editor の再レンダを誘発しない）。
 */
export const BrushCursor = forwardRef<BrushCursorHandle, BrushCursorProps>(
  function BrushCursor({ diameter, color, shape, borderWidth }, ref) {
    const elRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      move(x, y) {
        const el = elRef.current;
        if (!el) return;
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        el.style.opacity = "1";
      },
      hide() {
        const el = elRef.current;
        if (el) el.style.opacity = "0";
      },
    }), []);

    const bw = Math.max(borderWidth, 0.5);
    const size = Math.max(2, diameter);
    // 画面上の実寸は borderWidth(=1/displayScale) で割る。クランプ後の bw を使うと
    // 200% 超のズームで過小評価になり、大きいのに補助ドットが出てしまう
    const tiny = diameter / borderWidth < TINY_SCREEN_PX;

    // 文字は左上を原点に描かれる（draw.ts textBaseline "top"）。
    // 円ではなく、行の高さぶんのキャレットで着地点を示す
    const isText = shape === "text";
    const radius = shape === "circle" ? "9999px" : 0;

    // 外側 div の style は move()/hide() の専用領域にしておく。style prop を渡すと
    // React の差分適用で transform/opacity が飛ぶ余地ができる
    return (
      <div
        ref={elRef}
        className="pointer-events-none absolute left-0 top-0 opacity-0 will-change-transform"
        aria-hidden
      >
        <div
          className="absolute"
          style={
            isText
              ? {
                  left: 0,
                  top: 0,
                  width: Math.max(bw * 2, size * 0.06),
                  height: size,
                  backgroundColor: color,
                  // 明暗どちらの背景でも輪郭が出るよう黒縁を回す
                  boxShadow: `0 0 0 ${bw}px rgba(0,0,0,0.55)`,
                }
              : {
                  left: -size / 2,
                  top: -size / 2,
                  width: size,
                  height: size,
                  borderRadius: radius,
                  // 白／黒の二重リングで、同系色の背景でも消えないようにする
                  border: `${bw}px solid rgba(255,255,255,0.95)`,
                  boxShadow: `0 0 0 ${bw}px rgba(0,0,0,0.55), inset 0 0 0 ${bw}px rgba(0,0,0,0.55)`,
                  backgroundColor: `${color}${shape === "square" ? "59" : "2E"}`,
                }
          }
        />
        {/* 極小サイズは輪郭が潰れるので中心点で狙いを補う */}
        {tiny && !isText && (
          <div
            className="absolute rounded-full"
            style={{
              left: -bw,
              top: -bw,
              width: bw * 2,
              height: bw * 2,
              backgroundColor: "rgba(255,255,255,0.95)",
              boxShadow: `0 0 0 ${bw}px rgba(0,0,0,0.55)`,
            }}
          />
        )}
      </div>
    );
  }
);
