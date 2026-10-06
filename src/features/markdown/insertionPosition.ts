// Capture before asynchronous resource work; only restore inside the original editor.
export function captureInsertionPosition(root: HTMLElement | null): Range | null {
  const selection = window.getSelection();
  if (!root || !selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return root.contains(range.startContainer) && root.contains(range.endContainer)
    ? range.cloneRange()
    : null;
}

export function restoreInsertionPosition(root: HTMLElement | null, range: Range | null): void {
  if (
    !root?.isConnected ||
    !range ||
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    throw new Error("原插入位置已失效，请重新选择位置再插入图片");
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
