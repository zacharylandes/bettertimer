(() => {
  const LONG_PRESS_MS = 600;
  const DEFAULT_ON_MS = 60_000;
  const DEFAULT_OFF_MS = 45_000;

  const phaseEl = document.getElementById("phase");
  const timerEl = document.getElementById("timer");
  const fillEl = document.getElementById("fill");
  const timeEl = document.getElementById("time");
  const nextBlock = document.getElementById("nextBlock");
  const nextLabel = document.getElementById("nextLabel");
  const nextTime = document.getElementById("nextTime");
  const controlEl = document.getElementById("control");
  const lapEl = document.getElementById("lap");
  const hintEl = document.getElementById("hint");

  let onMs = DEFAULT_ON_MS;
  let offMs = DEFAULT_OFF_MS;

  /** @type {"idle" | "running" | "paused"} */
  let status = "idle";
  /** @type {"on" | "off"} */
  let phase = "on";
  let laps = 0;
  let phaseElapsed = 0;
  let lastTick = 0;
  let rafId = 0;
  let audioCtx = null;
  let editingNext = false;
  let editingCurrent = false;

  let pressTimer = null;
  let longPressed = false;

  function phaseDuration() {
    return phase === "on" ? onMs : offMs;
  }

  function upcomingPhase() {
    return phase === "on" ? "off" : "on";
  }

  function upcomingDuration() {
    return upcomingPhase() === "on" ? onMs : offMs;
  }

  function remainingMs() {
    return Math.max(0, phaseDuration() - phaseElapsed);
  }

  function canEditCurrent() {
    return status !== "running";
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
    const freq = phase === "on" ? 988 : 740;

    function blip(startAt, peak, dur) {
      const master = audioCtx.createGain();
      master.gain.setValueAtTime(0.0001, now + startAt);
      master.gain.exponentialRampToValueAtTime(peak, now + startAt + 0.012);
      master.gain.exponentialRampToValueAtTime(0.0001, now + startAt + dur);
      master.connect(audioCtx.destination);

      for (const [level, detune, ratio] of [
        [1.0, 0, 1],
        [0.55, 0, 2],
      ]) {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq * ratio, now + startAt);
        osc.detune.setValueAtTime(detune, now + startAt);
        g.gain.value = level;
        osc.connect(g);
        g.connect(master);
        osc.start(now + startAt);
        osc.stop(now + startAt + dur + 0.02);
      }
    }

    blip(0, 1.7, 0.24);
    blip(0.28, 1.5, 0.2);

    if (navigator.vibrate) {
      navigator.vibrate([70, 40, 70]);
    }
  }

  function flash() {
    timerEl.classList.remove("is-flash");
    void timerEl.offsetWidth;
    timerEl.classList.add("is-flash");
  }

  function applyCurrentDuration() {
    const ms = parseTime(timeEl.value);
    if (ms == null) {
      timeEl.value = formatTime(remainingMs());
      return false;
    }
    if (phase === "on") onMs = ms;
    else offMs = ms;
    phaseElapsed = 0;
    return true;
  }

  function applyNextDuration() {
    const ms = parseTime(nextTime.value);
    if (ms == null) {
      nextTime.value = formatTime(upcomingDuration());
      return false;
    }
    if (upcomingPhase() === "on") onMs = ms;
    else offMs = ms;
    return true;
  }

  function finishCurrentEdit(commit) {
    if (!editingCurrent) return;
    editingCurrent = false;
    timeEl.classList.remove("is-editing");
    if (commit) applyCurrentDuration();
    else timeEl.value = formatTime(remainingMs());
    timeEl.blur();
    render();
  }

  function finishNextEdit(commit) {
    if (!editingNext) return;
    editingNext = false;
    nextBlock.classList.remove("is-editing");
    if (commit) applyNextDuration();
    else nextTime.value = formatTime(upcomingDuration());
    nextTime.blur();
    render();
  }

  function syncCurrentEditability() {
    const editable = canEditCurrent();
    timeEl.readOnly = !editable;
    timeEl.classList.toggle("is-editable", editable);
    timeEl.tabIndex = editable ? 0 : -1;
  }

  function render() {
    const duration = phaseDuration();
    const remaining = remainingMs();
    const progress = duration > 0 ? Math.min(1, phaseElapsed / duration) : 0;
    const next = upcomingPhase();

    if (!editingCurrent) timeEl.value = formatTime(remaining);
    fillEl.style.height = `${progress * 100}%`;
    fillEl.dataset.phase = phase;

    phaseEl.textContent = phase.toUpperCase();
    phaseEl.classList.toggle("is-on", phase === "on");
    phaseEl.classList.toggle("is-off", phase === "off");

    nextLabel.textContent = `Next ${next}`;
    nextBlock.classList.toggle("is-on", next === "on");
    nextBlock.classList.toggle("is-off", next === "off");
    if (!editingNext) nextTime.value = formatTime(upcomingDuration());

    lapEl.textContent = `Lap ${laps}`;
    syncCurrentEditability();

    if (status === "running") {
      controlEl.textContent = "Pause";
      controlEl.classList.add("is-running");
      hintEl.textContent = "hold pause to reset";
    } else if (status === "paused") {
      controlEl.textContent = "Resume";
      controlEl.classList.remove("is-running");
      hintEl.textContent = "tap time to edit · hold to reset";
    } else {
      controlEl.textContent = "Start";
      controlEl.classList.remove("is-running");
      hintEl.textContent = "tap time to edit · hold start to reset";
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
    if (editingCurrent) finishCurrentEdit(true);
    if (editingNext) finishNextEdit(true);
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
    if (editingCurrent) finishCurrentEdit(false);
    if (editingNext) finishNextEdit(false);
    status = "idle";
    phase = "on";
    laps = 0;
    phaseElapsed = 0;
    lastTick = 0;
    onMs = DEFAULT_ON_MS;
    offMs = DEFAULT_OFF_MS;
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

  function startCurrentEdit() {
    if (!canEditCurrent() || editingCurrent) return;
    editingCurrent = true;
    timeEl.readOnly = false;
    timeEl.classList.add("is-editable", "is-editing");
    timeEl.focus();
    timeEl.select();
  }

  controlEl.addEventListener("click", (e) => {
    e.preventDefault();
    if (longPressed) {
      longPressed = false;
      return;
    }
    toggle();
  });

  controlEl.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0) return;
    longPressed = false;
    controlEl.setPointerCapture?.(e.pointerId);
    clearPressTimer();
    pressTimer = setTimeout(() => {
      longPressed = true;
      reset();
      if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
    }, LONG_PRESS_MS);
  });

  controlEl.addEventListener("pointerup", clearPressTimer);
  controlEl.addEventListener("pointercancel", clearPressTimer);
  controlEl.addEventListener("contextmenu", (e) => e.preventDefault());

  timeEl.addEventListener("pointerdown", (e) => {
    if (!canEditCurrent()) return;
    e.stopPropagation();
    startCurrentEdit();
  });

  timeEl.addEventListener("focus", () => {
    if (canEditCurrent()) startCurrentEdit();
  });

  timeEl.addEventListener("blur", () => finishCurrentEdit(true));

  timeEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finishCurrentEdit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finishCurrentEdit(false);
    }
  });

  nextTime.addEventListener("focus", () => {
    editingNext = true;
    nextBlock.classList.add("is-editing");
    nextTime.select();
  });

  nextTime.addEventListener("blur", () => finishNextEdit(true));

  nextTime.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finishNextEdit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finishNextEdit(false);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && status === "running") {
      lastTick = 0;
    }
  });

  render();
})();
