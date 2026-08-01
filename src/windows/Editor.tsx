import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { onCaptureComplete, getSettings, saveSettings, notifyEditorHidden } from "../lib/ipc";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Toolbar from "../components/Toolbar";
import { BrushCursor, type BrushCursorHandle } from "../components/editor/BrushCursor";
import { TextInputOverlay } from "../components/editor/TextInputOverlay";
import type { Tool, AnnotationColor, ArrowStyle, Annotation, AnnotationTool } from "../types/annotation";
import { isShapeTool } from "../types/annotation";
import {
  BRUSH_SIZE_DEFAULT,
  brushPreviewDiameter,
  previewShape,
  shouldShowSizeControl,
  textSizeFromBrush,
} from "../lib/brushSize";
import { createDrawingAnnotation, withUpdatedPoints } from "../lib/annotationFactory";
import { useEditorHistory } from "../hooks/useEditorHistory";
import { useCanvasPanZoom } from "../hooks/useCanvasPanZoom";
import { useEyedropper } from "../hooks/useEyedropper";
import { useAnnotationLayer } from "../hooks/useAnnotationLayer";
import { useCrop } from "../hooks/useCrop";
import { useEditorExport } from "../hooks/useEditorExport";
import { useLocalization } from "../lib/localization";

function isDrawableTool(tool: Tool): tool is AnnotationTool {
  return tool !== "crop" && tool !== "hand" && tool !== "text";
}

export default function Editor() {
  const { t } = useLocalization();
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const annotationCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeMulRef = useRef(1);

  const [imageData, setImageData] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [currentTool, setCurrentTool] = useState<Tool>("arrow");
  const [currentColor, setCurrentColor] = useState<AnnotationColor>("#FF3B30");
  const [currentSize, setCurrentSize] = useState(BRUSH_SIZE_DEFAULT);
  const [currentArrowStyle, setCurrentArrowStyle] = useState<ArrowStyle>("uniform");
  const [shapeFilled, setShapeFilled] = useState(false);
  const [background, setBackground] = useState({
    enabled: false,
    color: "#1a1a1a",
    padding: 40,
  });
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState("");
  const [status, setStatus] = useState("");
  const [imageFormat, setImageFormat] = useState<"png" | "jpeg">("png");
  const [favoriteColors, setFavoriteColors] = useState<string[]>([]);
  const [cornerRadius, setCornerRadius] = useState(0);
  const brushCursorRef = useRef<BrushCursorHandle>(null);

  const history = useEditorHistory();
  const panZoom = useCanvasPanZoom({
    containerRef,
    imageCanvasRef,
    annotationCanvasRef,
    backgroundEnabled: background.enabled,
    backgroundPadding: background.padding,
  });
  sizeMulRef.current = panZoom.sizeMul;

  const eyedropper = useEyedropper({ onPick: setCurrentColor });
  const layer = useAnnotationLayer({
    imageCanvasRef,
    annotationCanvasRef,
    annotations: history.annotations,
    sizeMulRef,
  });

  const crop = useCrop({
    currentTool,
    setCurrentTool,
    imageData,
    setImageData,
    annotations: history.annotations,
    imgSize,
    setImgSize,
    resetHistory: history.resetHistory,
    applyDisplaySize: panZoom.applyDisplaySize,
    imageCanvasRef,
    annotationCanvasRef,
    baseLayerRef: layer.baseLayerRef,
    ensureBaseLayer: layer.ensureBaseLayer,
    rebuildBaseLayer: layer.rebuildBaseLayer,
    annotationsRef: history.annotationsRef,
    sizeMul: panZoom.sizeMul,
    setStatus,
    t,
  });

  const { handleCopy, handleSave } = useEditorExport({
    imageCanvasRef,
    annotationCanvasRef,
    background,
    cornerRadius,
    imageFormat,
    setStatus,
    t,
  });

  useEffect(() => {
    if (!imageData) {
      setStatus(t("Waiting for capture…", "キャプチャを待っています…"));
    }
  }, [t, imageData]);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setImageFormat(s.image_format);
        setFavoriteColors(s.favorite_colors ?? []);
      })
      .catch(() => {});
  }, []);

  const saveFavoriteColors = (colors: string[]) => {
    getSettings().then((s) => saveSettings({ ...s, favorite_colors: colors })).catch(() => {});
  };

  const handleAddFavoriteColor = useCallback(() => {
    if (favoriteColors.length >= 8 || favoriteColors.includes(currentColor)) return;
    const updated = [...favoriteColors, currentColor];
    setFavoriteColors(updated);
    saveFavoriteColors(updated);
  }, [favoriteColors, currentColor]);

  const handleRemoveFavoriteColor = useCallback(
    (index: number) => {
      const updated = favoriteColors.filter((_, i) => i !== index);
      setFavoriteColors(updated);
      saveFavoriteColors(updated);
    },
    [favoriteColors]
  );

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | null = null;
    win
      .onCloseRequested((event) => {
        event.preventDefault();
        void win.hide().then(() => notifyEditorHidden());
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    onCaptureComplete((payload) => {
      setImageData("data:image/png;base64," + payload.image_base64);
      setImgSize({ w: payload.width, h: payload.height });
      history.resetHistory([]);
      panZoom.resetView();
      crop.clearCropRegion();
      setStatus(t("Copied · Editing", "コピー済み · 編集中"));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [history.resetHistory, panZoom.resetView, crop.clearCropRegion, t]);

  useEffect(() => {
    if (!imageData || !imageCanvasRef.current) return;
    const canvas = imageCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0);

      const annCanvas = annotationCanvasRef.current!;
      if (annCanvas.width !== img.width || annCanvas.height !== img.height) {
        annCanvas.width = img.width;
        annCanvas.height = img.height;
      }
      panZoom.applyDisplaySize(img.width, img.height);
      setImgSize({ w: img.width, h: img.height });
    };
    img.src = imageData;
  }, [imageData, panZoom.applyDisplaySize]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        history.handleUndo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        history.handleRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history.handleUndo, history.handleRedo]);

  const previewDiameter = brushPreviewDiameter(currentTool, currentSize, shapeFilled);
  const showBrushCursor = previewDiameter !== null && !eyedropper.isPickingColor && !pendingText;

  /** カーソルプレビューは再レンダを挟まず DOM を直接動かす */
  const moveBrushCursor = useCallback(
    (pos: PointLike | null) => {
      const handle = brushCursorRef.current;
      if (!handle) return;
      if (pos) handle.move(pos.x, pos.y);
      else handle.hide();
    },
    []
  );

  useEffect(() => {
    if (!showBrushCursor) moveBrushCursor(null);
  }, [showBrushCursor, moveBrushCursor]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (eyedropper.isPickingColor) {
      eyedropper.commitEyedrop();
      return;
    }
    if (panZoom.spaceHeld || panZoom.isPanning) return;
    if (currentTool === "hand") {
      panZoom.beginPan(e.clientX, e.clientY);
      return;
    }
    if (currentTool === "crop") {
      crop.beginCrop(layer.getPos(e));
      return;
    }
    if (currentTool === "text") {
      setPendingText(layer.getPos(e));
      setTextInput("");
      return;
    }
    if (!isDrawableTool(currentTool)) return;

    const pos = layer.getPos(e);
    const ann = createDrawingAnnotation({
      tool: currentTool,
      color: currentColor,
      brushSize: currentSize,
      points: [pos, pos],
      arrowStyle: currentArrowStyle,
      shapeFilled,
    });
    layer.ensureBaseLayer();
    layer.isDrawingRef.current = true;
    layer.drawingAnnRef.current = ann;
    layer.paintDragPreview(ann);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (eyedropper.isPickingColor) {
      eyedropper.sampleAt(e, imageCanvasRef.current, layer.getPos);
      return;
    }

    const pos = layer.getPos(e);
    // 描画中もカーソルは出したまま（CSS cursor は none なので消すと完全に見失う）
    moveBrushCursor(showBrushCursor ? pos : null);

    if (panZoom.isPanning && currentTool === "hand") {
      panZoom.movePan(e.clientX, e.clientY);
      return;
    }
    if (crop.cropDrawing) {
      crop.updateCrop(pos);
      return;
    }
    if (!layer.isDrawingRef.current || !layer.drawingAnnRef.current) return;

    let nextPos = pos;
    const cur = layer.drawingAnnRef.current;
    if (e.shiftKey && isShapeTool(cur.tool)) {
      const start = cur.points[0];
      const w = nextPos.x - start.x;
      const h = nextPos.y - start.y;
      const side = Math.max(Math.abs(w), Math.abs(h));
      nextPos = {
        x: start.x + side * Math.sign(w || 1),
        y: start.y + side * Math.sign(h || 1),
      };
    }

    const updated = withUpdatedPoints(
      cur,
      cur.tool === "pen" || cur.tool === "highlighter"
        ? [...cur.points, nextPos]
        : [cur.points[0], nextPos]
    );
    layer.drawingAnnRef.current = updated;
    layer.schedulePreview();
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (panZoom.isPanning && currentTool === "hand") {
      panZoom.endPan();
      return;
    }
    if (crop.cropDrawing) {
      crop.endCropDraw();
      return;
    }
    if (!layer.isDrawingRef.current || !layer.drawingAnnRef.current) return;
    const cur = layer.drawingAnnRef.current;
    const pos = layer.getPos(e);
    const finalAnn = withUpdatedPoints(
      cur,
      cur.tool === "pen" || cur.tool === "highlighter"
        ? [...cur.points, pos]
        : [cur.points[0], pos]
    );
    layer.isDrawingRef.current = false;
    layer.drawingAnnRef.current = null;
    history.pushHistory([...history.annotationsRef.current, finalAnn]);
  };

  /** 入場した瞬間に出す。最初の mousemove を待つとカーソルが無い時間ができる */
  const handleMouseEnter = (e: React.MouseEvent) => {
    if (showBrushCursor) moveBrushCursor(layer.getPos(e));
  };

  const handleMouseLeave = () => {
    moveBrushCursor(null);
  };

  const handleTextSubmit = useCallback(() => {
    if (!pendingText || !textInput.trim()) {
      setPendingText(null);
      setTextInput("");
      return;
    }
    const ann: Annotation = {
      tool: "text",
      color: currentColor,
      size: textSizeFromBrush(currentSize),
      points: [pendingText, pendingText],
      text: textInput.trim(),
    };
    history.pushHistory([...history.annotationsRef.current, ann]);
    setPendingText(null);
    setTextInput("");
  }, [pendingText, textInput, currentColor, currentSize, history]);

  const handleTextCancel = useCallback(() => {
    setPendingText(null);
    setTextInput("");
  }, []);

  const pad = background.enabled ? background.padding : 0;
  const showSize = shouldShowSizeControl(currentTool, shapeFilled);

  const toolControls = useMemo(
    () => ({
      current: currentTool,
      color: currentColor,
      size: currentSize,
      arrowStyle: currentArrowStyle,
      shapeFilled,
      showSize,
      onToolChange: setCurrentTool,
      onColorChange: setCurrentColor,
      onSizeChange: setCurrentSize,
      onArrowStyleChange: setCurrentArrowStyle,
      onShapeFilledChange: setShapeFilled,
    }),
    [currentTool, currentColor, currentSize, currentArrowStyle, shapeFilled, showSize]
  );

  const backgroundControls = useMemo(
    () => ({
      ...background,
      onEnabledChange: (enabled: boolean) => setBackground((b) => ({ ...b, enabled })),
      onColorChange: (color: string) => setBackground((b) => ({ ...b, color })),
      onPaddingChange: (padding: number) => setBackground((b) => ({ ...b, padding })),
    }),
    [background]
  );

  const frameControls = useMemo(
    () => ({
      cornerRadius,
      onCornerRadiusChange: setCornerRadius,
    }),
    [cornerRadius]
  );

  const historyControls = useMemo(
    () => ({
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      onUndo: history.handleUndo,
      onRedo: history.handleRedo,
    }),
    [history.canUndo, history.canRedo, history.handleUndo, history.handleRedo]
  );

  const cropControls = useMemo(
    () => ({
      hasRegion: crop.hasRegion,
      canRevert: crop.canRevert,
      onApply: crop.handleCropApply,
      onCancel: crop.handleCropCancel,
      onRevert: crop.handleCropRevert,
    }),
    [crop.hasRegion, crop.canRevert, crop.handleCropApply, crop.handleCropCancel, crop.handleCropRevert]
  );

  const colorControls = useMemo(
    () => ({
      favorites: favoriteColors,
      isPicking: eyedropper.isPickingColor,
      onAddFavorite: handleAddFavoriteColor,
      onRemoveFavorite: handleRemoveFavoriteColor,
      onEyedrop: eyedropper.startEyedrop,
    }),
    [
      favoriteColors,
      eyedropper.isPickingColor,
      handleAddFavoriteColor,
      handleRemoveFavoriteColor,
      eyedropper.startEyedrop,
    ]
  );

  return (
    <div className="flex flex-col h-screen bg-tb-base select-none">
      <Toolbar
        tool={toolControls}
        background={backgroundControls}
        frame={frameControls}
        history={historyControls}
        crop={cropControls}
        colors={colorControls}
        onCopy={handleCopy}
        onSave={handleSave}
      />

      <div
        ref={containerRef}
        className="flex-1 overflow-hidden flex items-center justify-center bg-tb-canvas"
        style={{ minHeight: 0, cursor: panZoom.spaceHeld || panZoom.isPanning ? "grab" : undefined }}
        onWheel={panZoom.handleWheel}
        onMouseDown={panZoom.handleContainerMouseDown}
        onMouseMove={panZoom.handleContainerMouseMove}
        onMouseUp={panZoom.handleContainerMouseUp}
        onMouseLeave={panZoom.handleContainerMouseUp}
      >
        {!imageData ? (
          <div className="text-tb-text-dim text-sm">{status}</div>
        ) : (
          <div
            style={{
              background: background.enabled ? background.color : "transparent",
              padding: pad,
              borderRadius: background.enabled ? Math.max(cornerRadius, 8) + 8 : cornerRadius,
              lineHeight: 0,
              boxShadow: background.enabled
                ? "0 8px 40px rgba(0,0,0,0.5)"
                : "0 4px 32px rgba(0,0,0,0.4)",
              transform: `translate(${panZoom.panOffset.x}px, ${panZoom.panOffset.y}px) scale(${panZoom.displayScale})`,
              transformOrigin: "center center",
            }}
          >
            <div
              className="relative"
              style={{
                lineHeight: 0,
                borderRadius: cornerRadius,
                overflow: pendingText ? "visible" : "hidden",
              }}
            >
              <canvas ref={imageCanvasRef} className="block" />
              <canvas
                ref={annotationCanvasRef}
                className="absolute inset-0"
                style={{
                  cursor: eyedropper.isPickingColor
                    ? "crosshair"
                    : currentTool === "hand"
                      ? panZoom.isPanning
                        ? "grabbing"
                        : "grab"
                      : previewDiameter !== null
                        ? "none"
                        : "crosshair",
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              />
              {showBrushCursor && (
                <BrushCursor
                  ref={brushCursorRef}
                  diameter={previewDiameter}
                  color={currentColor}
                  shape={previewShape(currentTool)}
                  borderWidth={panZoom.sizeMul}
                />
              )}
              {pendingText && (
                <TextInputOverlay
                  x={pendingText.x}
                  y={pendingText.y}
                  fontSize={textSizeFromBrush(currentSize)}
                  color={currentColor}
                  value={textInput}
                  canvasWidth={imgSize.w}
                  canvasHeight={imgSize.h}
                  onChange={setTextInput}
                  onSubmit={handleTextSubmit}
                  onCancel={handleTextCancel}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {eyedropper.isPickingColor && eyedropper.hoverColor && (
        <div
          className="fixed pointer-events-none z-50 flex items-center gap-2 bg-tb-raised text-tb-text text-[11px] px-2.5 py-1.5 rounded-lg shadow-lg border border-tb-border"
          style={{
            // 右端・下端では反対側に逃がす（画面外に出ると色が読めない）
            left: Math.min(eyedropper.hoverPos.x + 18, window.innerWidth - 108),
            top: Math.min(Math.max(eyedropper.hoverPos.y - 10, 8), window.innerHeight - 44),
          }}
        >
          <div
            className="w-4 h-4 rounded-sm border border-tb-border flex-shrink-0"
            style={{ backgroundColor: eyedropper.hoverColor }}
          />
          <span className="font-mono">{eyedropper.hoverColor}</span>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-2 text-[11px] bg-tb-base border-t border-tb-border">
        <span className="text-tb-text-sub">{status}</span>
        {imgSize.w > 0 && (
          <div className="flex items-center gap-3 text-tb-text-dim font-mono tabular-nums">
            <span>
              {imgSize.w} <span className="opacity-40">x</span> {imgSize.h}
            </span>
            <span className="bg-tb-raised rounded px-1.5 py-0.5 text-tb-text-sub">
              {Math.round(panZoom.displayScale * 100)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

interface PointLike {
  x: number;
  y: number;
}
