interface FullscreenWindow {
  isFullscreen(): Promise<boolean>;
  setFullscreen(value: boolean): Promise<void>;
}

// Serialize fullscreen transitions so a quick Escape cannot leave the native window fullscreen.
export function createFullscreenSync(window: FullscreenWindow) {
  let previous: boolean | undefined;
  let queue: Promise<void> = Promise.resolve();
  return (active: boolean) => {
    const next = queue
      .catch(() => {})
      .then(async () => {
        if (active) {
          if (previous === undefined) previous = await window.isFullscreen();
          await window.setFullscreen(true);
        } else if (previous !== undefined) {
          await window.setFullscreen(previous);
          previous = undefined;
        }
      });
    queue = next;
    return next;
  };
}
