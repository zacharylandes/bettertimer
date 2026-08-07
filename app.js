(() => {
  const LONG_PRESS_MS = 600;

  const phaseEl = document.getElementById("phase");
  const timerEl = document.getElementById("timer");
  const fillEl = document.getElementById("fill");
  const timeEl = document.getElementById("time");
  const lapEl = document.getElementById("lap");
  const hintEl = document.getElementById("hint");

  let onMs = 60_000;
  let offMs = 45_000;

  /** @type {"idle" | "running" | "paused"} */
  let status = "idle";
  /** @type {"on" | "off"} */
  let phase = "on";
  let laps = 0;
  let phaseElapsed = 0;
  let lastTick = 0;
  let rafId = 0;
  let audioCtx = null;
  let editing = false;

  let pressTimer = null;
  let longPressed = false;
  let pointerId = null;
  let ignoreToggle = false;

  function phaseDuration() {
    return phase === "on" ? onMs : offMs;
  }

  function formatTime(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function parseTime(raw) {
    const text = String(raw).trim().replace(/\s+/g, "");
    if (!text) return null;

    if (text.includes(":")) {
      const [mPart, sPart = "0"] = text.split(":");
      const m = Number(mPart);
      const s = Number(sPart);
      if (!Number.isFinite(m) || !Number.isFinite(s) || m < 0 || s < 0 || s > 59) {
        return null;
      }
      const total = Math.round(m * 60 + s);
      return total > 0 ? total * 1000 : null;
    }

    const asNum = Number(text);
    if (!Number.isFinite(asNum) || asNum <= 0) return null;
    // bare numbers: treat as seconds if <= 599, else mmss (e.g. 145 → 1:45)
    if (text.length >= 3 && asNum > 59) {
      const m = Math.floor(asNum / 100);
      const s = asNum % 100;
      if (s > 59) return null;
      const total = m * 60 + s;
      return total > 0 ? total * 1000 : null;
    }
    return Math.round(asNum) * 1000;
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
    const freq = phase === "on" ? 880 : 660;

    const master = audioCtx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.95, now + 0.015);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    master.connect(audioCtx.destination);

    for (const [type, gainLevel, detune] of [
      ["square", 0.55, 0],
      ["sawtooth", 0.35, -8],
    ]) {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      osc.detune.setValueAtTime(detune, now);
      g.gain.setValueAtTime(gainLevel, now);
      osc.connect(g);
      g.connect(master);
      osc.start(now);
      osc.stop(now + 0.34);
    }

    if (navigator.vibrate) {
      navigator.vibrate([50, 30, 50]);
    }
  }

  function flash() {
    timerEl.classList.remove("is-flash");
    void timerEl.offsetWidth;
    timerEl.classList.add("is-flash");
  }

  function syncEditability() {
    const editable = status !== "running";
    timeEl.readOnly = !editable;
    timeEl.classList.toggle("is-editable", editable);
    timeEl.tabIndex = editable ? 0 : -1;
  }

  function render() {
    if (!editing) {
      const duration = phaseDuration();
      const remaining = Math.max(0, duration - phaseElapsed);
      const progress = Math.min(1, phaseElapsed / duration);
      timeEl.value = formatTime(remaining);
      fillEl.style.height = `${progress * 100}%`;
    }

    fillEl.dataset.phase = phase;
    phaseEl.textContent = phase.toUpperCase();
    phaseEl.classList.toggle("is-on", phase === "on");
    phaseEl.classList.toggle("is-off", phase === "off");
    lapEl.textContent = `Lap ${laps}`;
    syncEditability();

    if (editing) {
      hintEl.textContent = "enter duration · done to save";
    } else if (status === "idle") {
      hintEl.textContent = "tap time to edit · tap to start · hold reset";
    } else if (status === "running") {
      hintEl.textContent = "tap to pause · hold to reset";
    } else {
      hintEl.textContent = "tap time to edit · tap to resume · hold reset";
    }
  }

  function applyEditedDuration() {
    const ms = parseTime(timeEl.value);
    if (ms == null) {
      timeEl.value = formatTime(Math.max(0, phaseDuration() - phaseElapsed));
      return false;
    }
    if (phase === "on") onMs = ms;
    else offMs = ms;
    phaseElapsed = 0;
    return true;
  }

  function startEditing(e) {
    if (status === "running") return;
    e?.stopPropagation();
    editing = true;
    ignoreToggle = true;
    clearPressTimer();
    timeEl.readOnly = false;
    timeEl.classList.add("is-editable", "is-editing");
    timeEl.focus();
    timeEl.select();
    hintEl.textContent = "enter duration · done to save";
  }

  function finishEditing(commit) {
    if (!editing) return;
    editing = false;
    timeEl.classList.remove("is-editing");
    if (commit) applyEditedDuration();
    else timeEl.value = formatTime(Math.max(0, phaseDuration() - phaseElapsed));
    timeEl.blur();
    render();
    // prevent the blur/tap from also toggling start
    setTimeout(() => {
      ignoreToggle = false;
    }, 0);
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
    if (editing) finishEditing(true);
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
    if (editing) finishEditing(false);
    status = "idle";
    phase = "on";
    laps = 0;
    phaseElapsed = 0;
    lastTick = 0;
    onMs = 60_000;
    offMs = 45_000;
    cancelAnimationFrame(rafId);
    rafId = 0;
    render();
  }

  function toggle() {
    if (ignoreToggle || editing) return;
    if (status === "running") pause();
    else start();
  }

  function clearPressTimer() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  function isTimeTarget(target) {
    return target === timeEl || timeEl.contains?.(target);
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    if (isTimeTarget(e.target) && status !== "running") {
      startEditing(e);
      return;
    }
    if (editing) return;

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
    if (editing) return;
    if (pointerId != null && e.pointerId !== pointerId) return;
    clearPressTimer();
    if (!longPressed && !ignoreToggle) toggle();
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
  timerEl.addEventListener("contextmenu", (e) => e.preventDefault());

  timerEl.addEventListener("keydown", (e) => {
    if (editing) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });

  timeEl.addEventListener("pointerdown", (e) => {
    if (status !== "running") {
      e.stopPropagation();
      startEditing(e);
    }
  });

  timeEl.addEventListener("focus", (e) => {
    if (status !== "running" && !editing) startEditing(e);
  });

  timeEl.addEventListener("blur", () => finishEditing(true));

  timeEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finishEditing(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finishEditing(false);
    }
    e.stopPropagation();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && status === "running") {
      lastTick = 0;
    }
  });

  render();
})();
