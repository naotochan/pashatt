import { useEffect, useRef, useState, useCallback } from "react";
import {
  captureRegion,
  doCaptureFullscreen,
  hideOverlay,
  getWindowList,
  captureWindowById,
  type WindowInfo,
} from "../lib/ipc";
import { useLocalization } from "../lib/localization";

type Mode = "region" | "window";

interface DragState {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

/** 選択範囲の内側だけ白く薄く覆う */
const SELECTION_FILL = "rgba(255, 255, 255, 0.35)";
const SELECTION_BORDER = "rgba(255, 255, 255, 0.95)";
const SELECTION_BORDER_SHADOW = "rgba(0, 0, 0, 0.35)";

function fillSelection(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
) {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = SELECTION_FILL;
  ctx.fillRect(x, y, w, h);
}

function strokeSelection(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lineWidth = 1.5
) {
  const inset = lineWidth / 2;
  const sw = Math.max(0, w - lineWidth);
  const sh = Math.max(0, h - lineWidth);
  ctx.lineWidth = lineWidth + 1;
  ctx.strokeStyle = SELECTION_BORDER_SHADOW;
  ctx.strokeRect(x + inset, y + inset, sw, sh);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = SELECTION_BORDER;
  ctx.strokeRect(x + inset, y + inset, sw, sh);
}

function hitTestFrontmost(
  windows: WindowInfo[],
  cx: number,
  cy: number
): WindowInfo | null {
  // CGWindowList は前面が先 → 最初にヒットした窓が最前面
  for (const w of windows) {
    if (cx >= w.x && cx <= w.x + w.w && cy >= w.y && cy <= w.y + w.h) {
      return w;
    }
  }
  return null;
}

/** 2矩形の交差。交差なしなら null */
function rectIntersection(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): { x: number; y: number; w: number; h: number } | null {
  const x = Math.max(ax, bx);
  const y = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  if (x2 <= x || y2 <= y) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

export default function Overlay() {
  const { t } = useLocalization();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef<Mode>("region");
  const windowsRef = useRef<WindowInfo[]>([]);
  const hoveredWinRef = useRef<WindowInfo | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const draggingRef = useRef(false);
  const rafRef = useRef(0);

  const [mode, setMode] = useState<Mode>("region");
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [hoveredWin, setHoveredWin] = useState<WindowInfo | null>(null);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = window.innerWidth;
    const H = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;

    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const currentMode = modeRef.current;
    const drag = dragRef.current;
    const win = hoveredWinRef.current;

    if (currentMode === "region") {
      if (drag) {
        const x = Math.min(drag.startX, drag.endX);
        const y = Math.min(drag.startY, drag.endY);
        const w = Math.abs(drag.endX - drag.startX);
        const h = Math.abs(drag.endY - drag.startY);

        fillSelection(ctx, x, y, w, h);
        strokeSelection(ctx, x, y, w, h);

        if (w > 60 && h > 20) {
          const label = `${Math.round(w)} × ${Math.round(h)}`;
          ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
          const tw = ctx.measureText(label).width;
          const boxW = tw + 12;
          const boxH = 20;
          const bx = x + (w - boxW) / 2;
          const by = y + h + 6;

          ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
          ctx.beginPath();
          ctx.roundRect(bx, by, boxW, boxH, 4);
          ctx.fill();
          ctx.fillStyle = "white";
          ctx.fillText(label, bx + 6, by + 14);
        }
      }
    } else if (currentMode === "window") {
      // ホバー中の窓だけ白くハイライト。前面窓に隠れた部分は塗らない
      if (win) {
        const { x, y, w, h } = win;
        fillSelection(ctx, x, y, w, h);

        const wins = windowsRef.current;
        const idx = wins.findIndex((winfo) => winfo.id === win.id);
        if (idx > 0) {
          for (let i = 0; i < idx; i++) {
            const front = wins[i];
            const overlap = rectIntersection(x, y, w, h, front.x, front.y, front.w, front.h);
            if (overlap) {
              ctx.clearRect(overlap.x, overlap.y, overlap.w, overlap.h);
            }
          }
        }

        strokeSelection(ctx, x, y, w, h, 2);
      }
    }
  }, []);

  const schedulePaint = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      paint();
    });
  }, [paint]);

  const setHovered = useCallback(
    (next: WindowInfo | null) => {
      const prev = hoveredWinRef.current;
      if (prev?.id === next?.id) return;
      hoveredWinRef.current = next;
      setHoveredWin(next);
      schedulePaint();
    },
    [schedulePaint]
  );

  const resetToDefault = useCallback(() => {
    modeRef.current = "region";
    dragRef.current = null;
    draggingRef.current = false;
    hoveredWinRef.current = null;
    windowsRef.current = [];
    setMode("region");
    setHoveredWin(null);
    setWindows([]);
    schedulePaint();
  }, [schedulePaint]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        resetToDefault();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [resetToDefault]);

  useEffect(() => {
    schedulePaint();
    const onResize = () => schedulePaint();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [schedulePaint]);

  const enterWindowMode = useCallback(async () => {
    modeRef.current = "window";
    hoveredWinRef.current = null;
    setMode("window");
    setHoveredWin(null);
    schedulePaint();
    try {
      const wins = await getWindowList();
      // 取得待ちの間にキャンセルされていたら結果を捨てる
      if (modeRef.current !== "window") return;
      windowsRef.current = wins;
      setWindows(wins);
    } catch {
      windowsRef.current = [];
      setWindows([]);
    }
  }, [schedulePaint]);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (modeRef.current === "region" && !draggingRef.current) {
          enterWindowMode();
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // モードに関わらずキャプチャ自体をキャンセルする。
        // hideOverlay の応答待ちに mouseup が走ってキャプチャされないよう、先に状態を落とす
        resetToDefault();
        try {
          await hideOverlay();
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resetToDefault, enterWindowMode]);

  const handleMouseDown = async (e: React.MouseEvent) => {
    if (modeRef.current === "window") {
      const win = hoveredWinRef.current;
      if (win) {
        resetToDefault();
        try {
          await hideOverlay();
          await captureWindowById(win.id);
        } catch {
          /* ignore */
        }
      }
      return;
    }

    draggingRef.current = true;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      endX: e.clientX,
      endY: e.clientY,
    };
    schedulePaint();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (modeRef.current === "region" && draggingRef.current && dragRef.current) {
      dragRef.current.endX = e.clientX;
      dragRef.current.endY = e.clientY;
      schedulePaint();
      return;
    }

    if (modeRef.current === "window" && windowsRef.current.length > 0) {
      setHovered(hitTestFrontmost(windowsRef.current, e.clientX, e.clientY));
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (modeRef.current !== "region" || !draggingRef.current || !dragRef.current) {
      return;
    }

    const drag = dragRef.current;
    const x = Math.min(drag.startX, e.clientX);
    const y = Math.min(drag.startY, e.clientY);
    const w = Math.abs(e.clientX - drag.startX);
    const h = Math.abs(e.clientY - drag.startY);

    draggingRef.current = false;
    dragRef.current = null;
    resetToDefault();

    // 先にオーバーレイを隠してからキャプチャ（残像・再描画を防ぐ）
    void (async () => {
      try {
        await hideOverlay();
        if (w > 10 && h > 10) {
          await captureRegion(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
        } else {
          await doCaptureFullscreen();
        }
      } catch {
        /* ignore */
      }
    })();
  };

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ cursor: mode === "window" ? "default" : "crosshair" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />

      <div
        className="absolute bottom-28 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-full text-white select-none pointer-events-none"
        style={{
          background: "rgba(0, 0, 0, 0.65)",
          backdropFilter: "blur(8px)",
          whiteSpace: "nowrap",
          fontSize: "13px",
        }}
      >
        {mode === "window"
          ? hoveredWin
            ? `${hoveredWin.name}  ｜  ${t("Click: Capture", "クリック: キャプチャ")}  ｜  Esc: ${t("Cancel", "キャンセル")}`
            : `${t("Select a window", "ウィンドウを選択")} (${windows.length})  ｜  ${t("Click: Capture", "クリック: キャプチャ")}  ｜  Esc: ${t("Cancel", "キャンセル")}`
          : `${t("Drag: Region", "ドラッグ: 範囲選択")}  ｜  ${t("Click: Full screen", "クリック: 全画面")}  ｜  Space: ${t("Window select", "ウィンドウ選択")}  ｜  Esc: ${t("Cancel", "キャンセル")}`}
      </div>
    </div>
  );
}
