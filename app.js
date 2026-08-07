(() => {
  const ON_MS = 60_000;
  const OFF_MS = 45_000;
  const LONG_PRESS_MS = 600;

  const phaseEl = document.getElementById("phase");
  const timerEl = document.getElementById("timer");
  const fillEl = document.getElementById("fill");
  const timeEl = document.getElementById("time");
  const lapEl = document.getElementById("lap");
  const hintEl = document.getElementById("hint");

  /** @type {"idle" | "running" | "paused"} */
  let status = "idle";
  /** @type {"on" | "off"} */
  let phase = "on";
  let laps = 0;
  let phaseElapsed = 0;
  let lastTick = 0;
  let rafId = 0;
  let audioCtx = null;

  let pressTimer = null;
  let longPressed = false;
  let pointerId = null;

  function phaseDuration() {
    return phase === "on" ? ON_MS : OFF_MS;
  }

  function formatTime(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function ensureAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx?.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
  }

  function beep() {
    ensureAudio();
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(phase === "on" ? 880 : 660, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.2);

    if (navigator.vibrate) {
      navigator.vibrate(40);
    }
  }

  function flash() {
    timerEl.classList.remove("is-flash");
    // force reflow so animation can replay
    void timerEl.offsetWidth;
    timerEl.classList.add("is-flash");
  }

  function render() {
    const duration = phaseDuration();
    const remaining = Math.max(0, duration - phaseElapsed);
    const progress = Math.min(1, phaseElapsed / duration);

    timeEl.textContent = formatTime(remaining);
    fillEl.style.height = `${progress * 100}%`;
    fillEl.dataset.phase = phase;

    phaseEl.textContent = phase.toUpperCase();
    phaseEl.classList.toggle("is-on", phase === "on");
    phaseEl.classList.toggle("is-off", phase === "off");

    lapEl.textContent = `Lap ${laps}`;

    if (status === "idle") {
      hintEl.textContent = "tap to start · hold to reset";
    } else if (status === "running") {
      hintEl.textContent = "tap to pause · hold to reset";
    } else {
      hintEl.textContent = "tap to resume · hold to reset";
    }
  }

  function advancePhase() {
    if (phase === "on") {
      phase = "off";
    } else {
      phase = "on";
      laps += 1;
    }
    phaseElapsed = 0;
    beep();
    flash();
  }

  function tick(now) {
    if (status !== "running") return;

    if (!lastTick) lastTick = now;
    phaseElapsed += now - lastTick;
    lastTick = now;

    const duration = phaseDuration();
    while (phaseElapsed >= duration) {
      phaseElapsed -= duration;
      advancePhase();
    }

    render();
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    ensureAudio();
    status = "running";
    lastTick = 0;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
    render();
  }

  function pause() {
    status = "paused";
    cancelAnimationFrame(rafId);
    rafId = 0;
    lastTick = 0;
    render();
  }

  function reset() {
    status = "idle";
    phase = "on";
    laps = 0;
    phaseElapsed = 0;
    lastTick = 0;
    cancelAnimationFrame(rafId);
    rafId = 0;
    render();
  }

  function toggle() {
    if (status === "running") pause();
    else start();
  }

  function clearPressTimer() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    pointerId = e.pointerId;
    longPressed = false;
    timerEl.setPointerCapture?.(pointerId);
    clearPressTimer();
    pressTimer = setTimeout(() => {
      longPressed = true;
      reset();
      if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
    }, LONG_PRESS_MS);
  }

  function onPointerUp(e) {
    if (pointerId != null && e.pointerId !== pointerId) return;
    clearPressTimer();
    if (!longPressed) toggle();
    pointerId = null;
  }

  function onPointerCancel() {
    clearPressTimer();
    pointerId = null;
  }

  timerEl.addEventListener("pointerdown", onPointerDown);
  timerEl.addEventListener("pointerup", onPointerUp);
  timerEl.addEventListener("pointercancel", onPointerCancel);
  timerEl.addEventListener("lostpointercapture", onPointerCancel);

  // Prevent context menu on long-press (mobile)
  timerEl.addEventListener("contextmenu", (e) => e.preventDefault());

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && status === "running") {
      lastTick = 0;
    }
  });

  render();
})();
