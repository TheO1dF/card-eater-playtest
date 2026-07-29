const DEFAULT_CONFIG = Object.freeze({
  min_threshold: 72,
  max_threshold: 116,
  threshold_ratio: 0.22,
  flick_velocity: 0.62,
  horizontal_flick_velocity: 0.52,
  horizontal_threshold: 64,
  min_flick_distance: 24,
  projection_ms: 120,
  max_rotation: 11,
  return_duration: 260,
  exit_duration: 170,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createGestureController(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  let element = null;
  let card = null;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  let deltaY = 0;
  let velocityY = 0;
  let velocityX = 0;
  let lastX = 0;
  let lastY = 0;
  let lastTime = 0;
  let threshold = config.min_threshold;
  let frame = 0;
  let resolving = false;

  function emitProgress() {
    const horizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.08;
    const progress = clamp(horizontal ? Math.abs(deltaX) / config.horizontal_threshold : Math.abs(deltaY) / threshold, 0, 1);
    config.onProgress?.({
      progress,
      direction: horizontal ? "postpone" : deltaY < -2 ? "discard" : deltaY > 2 ? "eat" : null,
      delta_x: deltaX,
      delta_y: deltaY,
    });
  }

  function paint() {
    if (!element) return;
    const horizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.08;
    const visualX = deltaX * (horizontal ? 0.78 : 0.34);
    const rotation = clamp(deltaX / 14, -config.max_rotation, config.max_rotation);
    const lift = Math.min(Math.abs(deltaY) / 900, 0.025);
    element.style.transform = `translate3d(${visualX}px, ${deltaY}px, 0) rotate(${rotation}deg) scale(${1.015 + lift})`;
    emitProgress();
  }

  function requestPaint() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(paint);
  }

  function clearPointer() {
    if (element && pointerId !== null && element.hasPointerCapture?.(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
    pointerId = null;
  }

  function resetVisual(immediate = false) {
    if (!element) return;
    element.style.transition = immediate
      ? "none"
      : `transform ${config.return_duration}ms cubic-bezier(.2,.9,.25,1.25), opacity 160ms ease`;
    element.style.transform = "";
    element.style.opacity = "1";
    deltaX = 0;
    deltaY = 0;
    velocityY = 0;
    velocityX = 0;
    config.onProgress?.({ progress: 0, direction: null, delta_x: 0, delta_y: 0 });
    if (!immediate) {
      setTimeout(() => { if (element && !resolving) element.style.transition = ""; }, config.return_duration);
    }
  }

  function resolve(action) {
    if (!element || !card || resolving) return false;
    resolving = true;
    const targetElement = element;
    const targetCard = card;
    const viewportTravel = Math.max(window.innerHeight * 0.72, targetElement.clientHeight * 1.35);
    const horizontalTravel = Math.max(window.innerWidth * 0.66, targetElement.clientWidth * 1.25);
    const exitY = action === "postpone" ? 0 : action === "discard" ? -viewportTravel : viewportTravel;
    const exitX = action === "postpone"
      ? (deltaX < 0 ? -horizontalTravel : horizontalTravel)
      : clamp(deltaX * 0.45, -80, 80);
    const rotation = clamp(deltaX / 10, -config.max_rotation * 1.5, config.max_rotation * 1.5);

    targetElement.style.pointerEvents = "none";
    targetElement.style.transition = `transform ${config.exit_duration}ms cubic-bezier(.18,.75,.24,1), opacity ${config.exit_duration}ms ease`;
    targetElement.style.transform = `translate3d(${exitX}px, ${exitY}px, 0) rotate(${rotation}deg) scale(.94)`;
    targetElement.style.opacity = "0";
    config.onProgress?.({ progress: 1, direction: action, delta_y: exitY });
    config.onCommit?.(action);

    element = null;
    card = null;
    clearPointer();
    setTimeout(() => {
      resolving = false;
      if (action === "eat") config.onEat?.(targetCard);
      else if (action === "discard") config.onDiscard?.(targetCard);
      else config.onPostpone?.(targetCard);
    }, config.exit_duration);
    return true;
  }

  function decideAction() {
    const projectedX = deltaX + velocityX * config.projection_ms;
    const projectedY = deltaY + velocityY * config.projection_ms;
    const hasHorizontalIntent = Math.abs(deltaX) > Math.abs(deltaY) * 1.08;
    const horizontalDistance = Math.abs(projectedX) >= config.horizontal_threshold;
    const horizontalFlick = Math.abs(deltaX) >= config.min_flick_distance && Math.abs(velocityX) >= config.horizontal_flick_velocity;
    if (hasHorizontalIntent && (horizontalDistance || horizontalFlick)) return "postpone";
    const hasVerticalIntent = Math.abs(deltaY) >= Math.abs(deltaX) * 0.55;
    const distanceCommit = Math.abs(projectedY) >= threshold;
    const flickCommit = Math.abs(deltaY) >= config.min_flick_distance && Math.abs(velocityY) >= config.flick_velocity;
    if (!hasVerticalIntent || (!distanceCommit && !flickCommit)) return null;
    return projectedY < 0 ? "discard" : "eat";
  }

  function onPointerDown(event) {
    if (!element || resolving || pointerId !== null || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    lastX = event.clientX;
    lastY = event.clientY;
    lastTime = event.timeStamp;
    deltaX = 0;
    deltaY = 0;
    velocityY = 0;
    velocityX = 0;
    threshold = clamp(element.clientHeight * config.threshold_ratio, config.min_threshold, config.max_threshold);
    element.style.transition = "none";
    element.setPointerCapture?.(pointerId);
  }

  function onPointerMove(event) {
    if (!element || event.pointerId !== pointerId) return;
    event.preventDefault();
    const timeDelta = Math.max(1, event.timeStamp - lastTime);
    const instantVelocity = (event.clientY - lastY) / timeDelta;
    const instantVelocityX = (event.clientX - lastX) / timeDelta;
    velocityY = velocityY * 0.68 + instantVelocity * 0.32;
    velocityX = velocityX * 0.68 + instantVelocityX * 0.32;
    deltaX = event.clientX - startX;
    deltaY = event.clientY - startY;
    lastY = event.clientY;
    lastX = event.clientX;
    lastTime = event.timeStamp;
    requestPaint();
  }

  function onPointerEnd(event) {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    cancelAnimationFrame(frame);
    const action = event.type === "pointercancel" ? null : decideAction();
    clearPointer();
    if (action) resolve(action);
    else resetVisual();
  }

  function detach() {
    if (!element) return;
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerEnd);
    element.removeEventListener("pointercancel", onPointerEnd);
  }

  return {
    bind(nextElement, nextCard) {
      detach();
      element = nextElement;
      card = nextCard;
      resolving = false;
      pointerId = null;
      if (!element) return;
      resetVisual(true);
      element.style.touchAction = "none";
      element.addEventListener("pointerdown", onPointerDown, { passive: false });
      element.addEventListener("pointermove", onPointerMove, { passive: false });
      element.addEventListener("pointerup", onPointerEnd, { passive: false });
      element.addEventListener("pointercancel", onPointerEnd, { passive: false });
    },
    commit(action) {
      if (action !== "eat" && action !== "discard" && action !== "postpone") return false;
      if (action === "postpone") deltaX = config.horizontal_threshold;
      else deltaY = action === "eat" ? threshold : -threshold;
      return resolve(action);
    },
    cancel() {
      clearPointer();
      resetVisual();
    },
    destroy() {
      detach();
      clearPointer();
      element = null;
      card = null;
      cancelAnimationFrame(frame);
    },
  };
}
