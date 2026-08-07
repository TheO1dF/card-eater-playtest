import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (file) => readFile(resolve(root, file), "utf8");

/**
 * A stand-in for the platform AudioContext whose first resume() never settles,
 * which is what iOS does when resume() is called with no user activation to
 * spend. Later calls succeed, the way a real gesture would.
 */
function stallingAudioContext(resumeCalls) {
  return class {
    constructor() {
      this.state = "suspended";
      this.sampleRate = 48_000;
    }

    createBuffer(channels, length) {
      return { getChannelData: () => new Float32Array(length) };
    }

    resume() {
      resumeCalls.push(this.state);
      if (resumeCalls.length === 1) return new Promise(() => {});
      this.state = "running";
      return Promise.resolve();
    }
  };
}

// A timeout, not an await, is the failure mode that matters here: the bug this
// covers is a promise that never settles, so without it a regression hangs the
// whole suite instead of reporting itself.
test("a stalled audio unlock never blocks the next gesture", { timeout: 5000 }, async () => {
  const resumeCalls = [];
  globalThis.window = { AudioContext: stallingAudioContext(resumeCalls) };
  const { unlockAudio } = await import("../js/audio.js");
  delete globalThis.window;

  // The reported bug: the first tap's resume() hung, the hung promise was
  // cached and handed to every later caller, and audio stayed dead until the
  // page reloaded — which is why players found that saving and returning to
  // the title screen was the way to turn sound on.
  const stalled = unlockAudio();
  const running = await unlockAudio();

  assert.equal(resumeCalls.length, 2, "a pending unlock must not swallow the next gesture");
  assert.equal(running.state, "running");
  assert.notEqual(stalled, running, "each gesture needs its own attempt");
  assert.equal((await unlockAudio()).state, "running");
  assert.equal(resumeCalls.length, 2, "a running context needs no further resume");
});

test("audio unlocks from events that grant user activation", async () => {
  const main = await read("js/main.js");
  const start = main.indexOf("const unlockFromGesture");
  assert.ok(start > 0, "the gesture unlock is missing");
  const block = main.slice(start, main.indexOf("\n}", main.indexOf("addEventListener(type", start)));

  // Only some events grant user activation. `touchstart` never does, and
  // `pointerdown` only counts for a mouse — so a phone listening to just those
  // called resume() with nothing to spend.
  for (const type of ["pointerup", "touchend", "click"]) {
    assert.ok(block.includes(`"${type}"`), `${type} grants activation on touch and must be handled`);
  }
  assert.ok(!/audioUnlockPending/u.test(main),
    "a pending flag around an unlock that can hang forever deadlocks audio for the page's life");
});
