import { expect, it, vi } from "vitest";
import { createFullscreenSync } from "./fullscreen";

it("restores the original window state after a quick enter and Escape", async () => {
  let release!: (value: boolean) => void;
  const window = {
    isFullscreen: vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    ),
    setFullscreen: vi.fn(async (_value: boolean) => {}),
  };
  const sync = createFullscreenSync(window);
  const enter = sync(true);
  const escape = sync(false);
  await vi.waitFor(() => expect(window.isFullscreen).toHaveBeenCalled());
  release(false);
  await Promise.all([enter, escape]);
  expect(window.setFullscreen.mock.calls).toEqual([[true], [false]]);
  await sync(false);
  expect(window.setFullscreen).toHaveBeenCalledTimes(2);
});

it("preserves an already fullscreen window and can recover from a failed transition", async () => {
  const window = {
    isFullscreen: vi.fn(async () => true),
    setFullscreen: vi.fn(async (_value: boolean) => {}),
  };
  const sync = createFullscreenSync(window);
  window.setFullscreen.mockRejectedValueOnce(new Error("window busy"));
  await expect(sync(true)).rejects.toThrow("window busy");
  await sync(false);
  expect(window.setFullscreen).toHaveBeenLastCalledWith(true);
});
