import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import type { Annotation, Point } from "../types/annotation";
import { drawAnnotation } from "../lib/draw";

interface UseAnnotationLayerOpts {
  imageCanvasRef: RefObject<HTMLCanvasElement | null>;
  annotationCanvasRef: RefObject<HTMLCanvasElement | null>;
  annotations: Annotation[];
  sizeMulRef: MutableRefObject<number>;
}

export function useAnnotationLayer({
  imageCanvasRef,
  annotationCanvasRef,
  annotations,
  sizeMulRef,
}: UseAnnotationLayerOpts) {
  const baseLayerRef = useRef<HTMLCanvasElement | null>(null);
  const drawingAnnRef = useRef<Annotation | null>(null);
  const isDrawingRef = useRef(false);
  const rafRef = useRef(0);

  const ensureBaseLayer = useCallback(() => {
    const annCanvas = annotationCanvasRef.current;
    if (!annCanvas) return null;
    if (!baseLayerRef.current) baseLayerRef.current = document.createElement("canvas");
    const base = baseLayerRef.current;
    if (base.width !== annCanvas.width || base.height !== annCanvas.height) {
      base.width = annCanvas.width;
      base.height = annCanvas.height;
    }
    return base;
  }, [annotationCanvasRef]);

  const rebuildBaseLayer = useCallback(
    (anns: Annotation[]) => {
      const annCanvas = annotationCanvasRef.current;
      const base = ensureBaseLayer();
      if (!annCanvas || !base) return;
      const bctx = base.getContext("2d");
      const actx = annCanvas.getContext("2d");
      if (!bctx || !actx) return;
      bctx.clearRect(0, 0, base.width, base.height);
      for (const ann of anns) drawAnnotation(bctx, ann, 1, imageCanvasRef.current);
      actx.clearRect(0, 0, annCanvas.width, annCanvas.height);
      actx.drawImage(base, 0, 0);
    },
    [ensureBaseLayer, annotationCanvasRef, imageCanvasRef]
  );

  const paintDragPreview = useCallback(
    (ann: Annotation) => {
      const annCanvas = annotationCanvasRef.current;
      const base = baseLayerRef.current ?? ensureBaseLayer();
      if (!annCanvas || !base) return;
      const ctx = annCanvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, annCanvas.width, annCanvas.height);
      ctx.drawImage(base, 0, 0);

      drawAnnotation(ctx, ann, 1, imageCanvasRef.current);

      // モザイクは結果が見えないと粒度を選べないので、実際のモザイクを出したうえで
      // 範囲を白黒の破線で示す（どんな画像の上でも読める）
      if (ann.tool === "mosaic") {
        const [s, e] = ann.points;
        const x = Math.min(s.x, e.x);
        const y = Math.min(s.y, e.y);
        const w = Math.abs(e.x - s.x);
        const h = Math.abs(e.y - s.y);
        const mul = sizeMulRef.current;
        ctx.save();
        ctx.lineWidth = Math.max(1, mul);
        ctx.setLineDash([5 * mul, 4 * mul]);
        ctx.strokeStyle = "rgba(0,0,0,0.65)";
        ctx.strokeRect(x, y, w, h);
        ctx.lineDashOffset = 5 * mul;
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      }
    },
    [ensureBaseLayer, annotationCanvasRef, imageCanvasRef, sizeMulRef]
  );

  useEffect(() => {
    if (isDrawingRef.current) return;
    rebuildBaseLayer(annotations);
  }, [annotations, rebuildBaseLayer]);

  const getPos = useCallback(
    (e: React.MouseEvent): Point => {
      const canvas = annotationCanvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
      return {
        x: ((e.clientX - rect.left) / rect.width) * canvas.width,
        y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      };
    },
    [annotationCanvasRef]
  );

  const schedulePreview = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (drawingAnnRef.current) paintDragPreview(drawingAnnRef.current);
    });
  }, [paintDragPreview]);

  return {
    baseLayerRef,
    drawingAnnRef,
    isDrawingRef,
    ensureBaseLayer,
    rebuildBaseLayer,
    paintDragPreview,
    schedulePreview,
    getPos,
  };
}
