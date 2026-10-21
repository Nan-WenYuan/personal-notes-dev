export interface Point {
  x: number;
  y: number;
}
export type Annotation = { color: string; size: number } & (
  | { type: "arrow" | "rectangle"; start: Point; end: Point }
  | { type: "text"; start: Point; text: string }
);
export function imagePoint(
  client: Point,
  bounds: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
): Point {
  return {
    x: Math.max(0, Math.min(width, ((client.x - bounds.left) / bounds.width) * width)),
    y: Math.max(0, Math.min(height, ((client.y - bounds.top) / bounds.height) * height)),
  };
}
export function arrowHead(start: Point, end: Point, size: number): Point[] {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  return [1, -1].map((sign) => ({
    x: end.x - size * Math.cos(angle + (sign * Math.PI) / 6),
    y: end.y - size * Math.sin(angle + (sign * Math.PI) / 6),
  }));
}
export async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = src;
  try {
    await image.decode();
  } catch {
    throw Error("图片读取失败，网络图片请先保存到本地后再试");
  }
  return image;
}
export async function annotatedPng(src: string, annotations: readonly Annotation[]): Promise<Blob> {
  const image = await loadImage(src);
  if (image.naturalWidth * image.naturalHeight > 64_000_000)
    throw Error("图片过大，暂不支持标注导出");
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw Error("无法创建图片画布");
  context.drawImage(image, 0, 0);
  for (const a of annotations) {
    context.strokeStyle = a.color;
    context.fillStyle = a.color;
    context.lineWidth = a.size;
    context.lineJoin = "round";
    context.lineCap = "round";
    if (a.type === "text") {
      context.font = `${a.size * 7}px "HarmonyOS Sans SC", sans-serif`;
      context.textBaseline = "top";
      a.text
        .split("\n")
        .forEach((line, i) => context.fillText(line, a.start.x, a.start.y + i * a.size * 8.4));
    } else if (a.type === "rectangle") {
      context.strokeRect(a.start.x, a.start.y, a.end.x - a.start.x, a.end.y - a.start.y);
    } else {
      const [left, right] = arrowHead(a.start, a.end, a.size * 4);
      context.beginPath();
      context.moveTo(a.start.x, a.start.y);
      context.lineTo(a.end.x, a.end.y);
      context.moveTo(left.x, left.y);
      context.lineTo(a.end.x, a.end.y);
      context.lineTo(right.x, right.y);
      context.stroke();
    }
  }
  try {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw Error("图片生成失败");
    if (blob.size > 20 * 1024 * 1024) throw Error("标注图片超过 20 MB，请减少标注后重试");
    return blob;
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError")
      throw Error("这张网络图片不允许导出，请先保存为本地图片");
    throw error;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
