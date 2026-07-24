import { useCallback, type RefObject } from "react";
import { copyToClipboard, getSettings, saveImage, notifyEditorHidden } from "../lib/ipc";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface BackgroundState {
  enabled: boolean;
  color: string;
  padding: number;
}

type Translate = (english: string, japanese: string) => string;

interface UseEditorExportOpts {
  imageCanvasRef: RefObject<HTMLCanvasElement | null>;
  annotationCanvasRef: RefObject<HTMLCanvasElement | null>;
  background: BackgroundState;
  cornerRadius: number;
  imageFormat: "png" | "jpeg";
  setStatus: (s: string) => void;
  t: Translate;
}

export function useEditorExport({
  imageCanvasRef,
  annotationCanvasRef,
  background,
  cornerRadius,
  imageFormat,
  setStatus,
  t,
}: UseEditorExportOpts) {
  const compositeCanvas = useCallback((): HTMLCanvasElement => {
    const imgC = imageCanvasRef.current!;
    const annC = annotationCanvasRef.current!;
    const out = document.createElement("canvas");
    const ctx = out.getContext("2d")!;
    const pxPad = background.enabled ? Math.round(background.padding) : 0;
    const pxRadius = cornerRadius > 0 ? cornerRadius : 0;

    if (!background.enabled) {
      out.width = imgC.width;
      out.height = imgC.height;
      if (pxRadius > 0 && imageFormat === "jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, out.width, out.height);
      }
      if (pxRadius > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(0, 0, imgC.width, imgC.height, pxRadius);
        ctx.clip();
      }
      ctx.drawImage(imgC, 0, 0);
      ctx.drawImage(annC, 0, 0);
      if (pxRadius > 0) ctx.restore();
    } else {
      out.width = imgC.width + pxPad * 2;
      out.height = imgC.height + pxPad * 2;
      ctx.fillStyle = background.color;
      ctx.fillRect(0, 0, out.width, out.height);
      if (pxRadius > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(pxPad, pxPad, imgC.width, imgC.height, pxRadius);
        ctx.clip();
      }
      ctx.drawImage(imgC, pxPad, pxPad);
      ctx.drawImage(annC, pxPad, pxPad);
      if (pxRadius > 0) ctx.restore();
    }
    return out;
  }, [imageCanvasRef, annotationCanvasRef, background, cornerRadius, imageFormat]);

  const handleCopy = useCallback(async () => {
    const editing = t("Editing", "編集中");
    try {
      const out = compositeCanvas();
      const mime = imageFormat === "jpeg" ? "image/jpeg" : "image/png";
      const prefix = `data:${mime};base64,`;
      const b64 = out.toDataURL(mime).replace(prefix, "");
      await copyToClipboard(b64, imageFormat === "jpeg" ? "jpg" : "png");
      setStatus(t("Copied to clipboard", "クリップボードにコピーしました"));
      setTimeout(() => setStatus(editing), 2000);
    } catch (err) {
      setStatus(`${t("Copy failed", "コピーに失敗しました")}: ${err}`);
      setTimeout(() => setStatus(editing), 3000);
    }
  }, [compositeCanvas, imageFormat, setStatus, t]);

  const handleSave = useCallback(async () => {
    const editing = t("Editing", "編集中");
    try {
      const out = compositeCanvas();
      const isJpeg = imageFormat === "jpeg";
      const mime = isJpeg ? "image/jpeg" : "image/png";
      const ext = isJpeg ? "jpg" : "png";
      const prefix = `data:${mime};base64,`;
      const b64 = out.toDataURL(mime).replace(prefix, "");

      const settings = await getSettings();
      const dir = settings.save_directory;
      const now = new Date();
      const yyyy = now.getFullYear().toString();
      const mo = (now.getMonth() + 1).toString().padStart(2, "0");
      const dd = now.getDate().toString().padStart(2, "0");
      const hh = now.getHours().toString().padStart(2, "0");
      const mm = now.getMinutes().toString().padStart(2, "0");
      const ss = now.getSeconds().toString().padStart(2, "0");
      const filename = `pashatt-${yyyy}${mo}${dd}-${hh}${mm}${ss}.${ext}`;
      const fullPath = `${dir}/${filename}`;

      await saveImage(b64, fullPath);
      setStatus(`${t("Saved", "保存しました")}: ${fullPath}`);
      setTimeout(() => {
        void getCurrentWindow()
          .hide()
          .then(() => notifyEditorHidden());
      }, 500);
    } catch (err) {
      setStatus(`${t("Save failed", "保存に失敗しました")}: ${err}`);
      setTimeout(() => setStatus(editing), 3000);
    }
  }, [compositeCanvas, imageFormat, setStatus, t]);

  return { compositeCanvas, handleCopy, handleSave };
}
