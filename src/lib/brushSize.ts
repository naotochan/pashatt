import type { Tool } from "../types/annotation";

/** ブラシ太さ（画像の native 画素）の UI 範囲 */
export const BRUSH_SIZE_MIN = 1;
export const BRUSH_SIZE_MAX = 40;
export const BRUSH_SIZE_DEFAULT = 4;

export const HIGHLIGHTER_WIDTH_MUL = 8;
export const MOSAIC_BLOCK_MUL = 2.5;
export const MOSAIC_BLOCK_MIN = 8;
export const MOSAIC_BLOCK_MAX = 64;

/** 太さスライダー値 → テキスト描画のフォントサイズ（native px） */
export function textSizeFromBrush(brushSize: number): number {
  return brushSize * 6 + 12;
}

/** 太さスライダー値 → ハイライタ線幅（native px） */
export function highlighterWidthFromBrush(brushSize: number): number {
  return brushSize * HIGHLIGHTER_WIDTH_MUL;
}

/** 太さスライダー値 → モザイクブロックサイズ（native px） */
export function mosaicBlockFromBrush(brushSize: number): number {
  return Math.max(
    MOSAIC_BLOCK_MIN,
    Math.min(MOSAIC_BLOCK_MAX, Math.round(brushSize * MOSAIC_BLOCK_MUL))
  );
}

/** ツールに応じた実効サイズ（描画・プレビュー用、画像 px） */
export function effectiveSizeFromBrush(tool: Tool, brushSize: number): number {
  switch (tool) {
    case "text":
      return textSizeFromBrush(brushSize);
    case "highlighter":
      return highlighterWidthFromBrush(brushSize);
    case "mosaic":
      return mosaicBlockFromBrush(brushSize);
    default:
      return brushSize;
  }
}

export function sizeControlLabel(
  tool: Tool,
  t: (english: string, japanese: string) => string = (_en, ja) => ja
): string {
  switch (tool) {
    case "text":
      return t("Text", "文字");
    case "highlighter":
      return t("Highlight", "ハイライト");
    case "mosaic":
      return t("Block", "粗さ");
    default:
      return t("Size", "太さ");
  }
}

/**
 * スライダー値がそのまま実効 px になるツールだけ `px` 単位を名乗れる。
 * ハイライト／文字／モザイクの値は倍率であって px ではない。
 */
export function isSizeInPixels(tool: Tool): boolean {
  return tool !== "text" && tool !== "highlighter" && tool !== "mosaic";
}

/** 塗りつぶし図形・パン・クロップでは太さ UI を出さない */
export function shouldShowSizeControl(tool: Tool, shapeFilled: boolean): boolean {
  if (tool === "hand" || tool === "crop") return false;
  if ((tool === "rect" || tool === "ellipse") && shapeFilled) return false;
  return true;
}

/**
 * プレビューの描き分け。実際の描画（draw.ts）に形を合わせる:
 * - `square`  ハイライタは lineCap "square"
 * - `text`    文字は左上を原点に描かれるのでキャレット表示
 * - `block`   モザイクはブロック粒度
 */
export type PreviewShape = "circle" | "square" | "text" | "block";

export function previewShape(tool: Tool): PreviewShape {
  switch (tool) {
    case "highlighter":
      return "square";
    case "text":
      return "text";
    case "mosaic":
      return "block";
    default:
      return "circle";
  }
}

/** カーソル下のブラシプレビュー直径（不要なら null） */
export function brushPreviewDiameter(
  tool: Tool,
  brushSize: number,
  shapeFilled: boolean
): number | null {
  if (!shouldShowSizeControl(tool, shapeFilled)) return null;
  if (tool === "mosaic") return null;
  return effectiveSizeFromBrush(tool, brushSize);
}
