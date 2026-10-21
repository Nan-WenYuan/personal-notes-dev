import { readImage, readText, writeImage, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Image as NativeImage } from "@tauri-apps/api/image";
import { loadImage } from "./annotations";

export async function copyNoteSelection(imageSrc?: string): Promise<void> {
  if (imageSrc) {
    const image = await loadImage(imageSrc);
    if (image.naturalWidth * image.naturalHeight > 64_000_000)
      throw Error("图片过大，暂不支持复制");
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw Error("无法读取图片");
    try {
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      // Pass RGBA resources: the application does not enable Tauri's PNG decoder.
      const resource = await NativeImage.new(
        new Uint8Array(pixels.data),
        canvas.width,
        canvas.height,
      );
      try {
        await writeImage(resource);
      } finally {
        await resource.close();
      }
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } else if (!document.execCommand("copy")) {
    await writeText(window.getSelection()?.toString() ?? "");
  }
}
export async function pasteNoteClipboard(target: HTMLElement): Promise<void> {
  const data = new DataTransfer();
  // Native WebView clipboard APIs do not reliably expose screenshots. Read the
  // OS image through Tauri, then route it through the ordinary paste handler.
  try {
    const image = await readImage();
    try {
      const { width, height } = await image.size();
      if (width * height > 64_000_000) throw Error("剪贴板图片过大");
      const rgba = await image.rgba();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw Error("无法读取剪贴板图片");
      context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      canvas.width = 0;
      canvas.height = 0;
      if (blob) data.items.add(new File([blob], "粘贴图片.png", { type: "image/png" }));
    } finally {
      await image.close();
    }
  } catch {
    data.setData("text/plain", await readText());
  }
  if (!target.isConnected) return;
  target.dispatchEvent(
    new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
  );
}
