/**
 * Temporary browser PTT client.
 * Isolated from core: talks only to Voice Gateway WebSocket protocol.
 * Delete `clients/web-ptt` when a real desktop/room client exists.
 */

const TARGET_RATE = 24000;
const MIN_COMMIT_MS = 120;
const TOAST_MS = 10000;
const DEBUG_REFRESH_MS = 5000;

const els = {
  wsUrl: document.getElementById("wsUrl"),
  connectBtn: document.getElementById("connectBtn"),
  talkBtn: document.getElementById("talkBtn"),
  textForm: document.getElementById("textForm"),
  textInput: document.getElementById("textInput"),
  sendBtn: document.getElementById("sendBtn"),
  status: document.getElementById("status"),
  log: document.getElementById("log"),
  toasts: document.getElementById("toasts"),
  debugRemindersDetails: document.getElementById("debugRemindersDetails"),
  debugRefreshBtn: document.getElementById("debugRefreshBtn"),
  debugRemindersMeta: document.getElementById("debugRemindersMeta"),
  debugRemindersTable: document.getElementById("debugRemindersTable"),
};

function setTextEnabled(enabled) {
  els.textInput.disabled = !enabled;
  els.sendBtn.disabled = !enabled;
}

/** @type {WebSocket | null} */
let ws = null;
let ready = false;
let recording = false;
/** @type {MediaStream | null} */
let mediaStream = null;
/** @type {AudioContext | null} */
let captureCtx = null;
/** @type {ScriptProcessorNode | null} */
let processorNode = null;
let bytesSent = 0;

/** @type {AudioContext | null} */
let playCtx = null;
let playTime = 0;
let playChain = Promise.resolve();

/** @type {ReturnType<typeof setInterval> | null} */
let debugTimer = null;

function log(line) {
  const stamp = new Date().toLocaleTimeString();
  els.log.textContent += `[${stamp}] ${line}\n`;
  els.log.scrollTop = els.log.scrollHeight;
}

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.className = `status ${kind}`.trim();
}

function httpBaseFromWsUrl(wsUrl) {
  try {
    const u = new URL(wsUrl);
    const proto = u.protocol === "wss:" ? "https:" : "http:";
    return `${proto}//${u.host}`;
  } catch {
    return "http://127.0.0.1:8787";
  }
}

function showToast(title, body, meta = "") {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `
    <p class="toast-title"></p>
    <button type="button" class="toast-close" aria-label="Close">×</button>
    <p class="toast-body"></p>
    <p class="toast-meta"></p>
  `;
  el.querySelector(".toast-title").textContent = title;
  el.querySelector(".toast-body").textContent = body;
  el.querySelector(".toast-meta").textContent = meta;
  const close = () => el.remove();
  el.querySelector(".toast-close").addEventListener("click", close);
  els.toasts.appendChild(el);
  setTimeout(close, TOAST_MS);
}

function shortId(id) {
  return id ? `${id.slice(0, 8)}…` : "";
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function refreshDebugReminders() {
  if (!els.debugRemindersDetails?.open) return;
  const base = httpBaseFromWsUrl(els.wsUrl.value.trim());
  try {
    const res = await fetch(`${base}/debug/reminders`);
    const json = await res.json();
    if (!json.ok) {
      els.debugRemindersMeta.textContent = `error: ${json.error ?? res.status}`;
      return;
    }
    const rows = json.reminders ?? [];
    els.debugRemindersMeta.textContent = `${rows.length} rows · ${new Date().toLocaleTimeString()}`;
    const tbody = els.debugRemindersTable.querySelector("tbody");
    tbody.innerHTML = rows
      .map((r) => {
        const rec = r.recurrence ? JSON.stringify(r.recurrence) : "—";
        return `<tr>
          <td>${escapeHtml(r.status)}</td>
          <td>${escapeHtml(r.fire_at_local)}</td>
          <td class="text-cell">${escapeHtml(r.text)}</td>
          <td>${escapeHtml(rec)}</td>
          <td title="${escapeHtml(r.id)}">${escapeHtml(shortId(r.id))}</td>
          <td class="text-cell">${escapeHtml(r.raw_utterance ?? "—")}</td>
        </tr>`;
      })
      .join("");
  } catch (err) {
    els.debugRemindersMeta.textContent = `fetch failed: ${String(err)}`;
  }
}

function syncDebugTimer() {
  if (debugTimer) {
    clearInterval(debugTimer);
    debugTimer = null;
  }
  if (els.debugRemindersDetails?.open) {
    void refreshDebugReminders();
    debugTimer = setInterval(() => void refreshDebugReminders(), DEBUG_REFRESH_MS);
  }
}

function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function downsampleTo24k(float32, inputRate) {
  if (inputRate === TARGET_RATE) return float32;
  const ratio = inputRate / TARGET_RATE;
  const newLen = Math.floor(float32.length / ratio);
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, float32.length - 1);
    const frac = idx - i0;
    result[i] = float32[i0] * (1 - frac) + float32[i1] * frac;
  }
  return result;
}

function pcm16ToBase64(int16) {
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

async function ensurePlayCtx() {
  if (!playCtx) {
    playCtx = new AudioContext({ sampleRate: TARGET_RATE });
    playTime = playCtx.currentTime;
  }
  if (playCtx.state === "suspended") await playCtx.resume();
  return playCtx;
}

function enqueuePcm16Base64(b64) {
  playChain = playChain.then(async () => {
    const ctx = await ensurePlayCtx();
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const samples = new Int16Array(bytes.buffer);
    if (samples.length === 0) return;

    const audioBuffer = ctx.createBuffer(1, samples.length, TARGET_RATE);
    const channel = audioBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      channel[i] = samples[i] / 0x8000;
    }

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, playTime);
    src.start(startAt);
    playTime = startAt + audioBuffer.duration;
  });
}

async function startCapture() {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  captureCtx = new AudioContext();
  const source = captureCtx.createMediaStreamSource(mediaStream);
  const processor = captureCtx.createScriptProcessor(4096, 1, 1);
  processorNode = processor;
  const mute = captureCtx.createGain();
  mute.gain.value = 0;

  processor.onaudioprocess = (ev) => {
    if (!recording || !ready) return;
    const input = ev.inputBuffer.getChannelData(0);
    const down = downsampleTo24k(input, captureCtx.sampleRate);
    const pcm = floatTo16BitPCM(down);
    bytesSent += pcm.byteLength;
    send({ type: "audio.append", audio: pcm16ToBase64(pcm) });
  };

  source.connect(processor);
  processor.connect(mute);
  mute.connect(captureCtx.destination);
}

function stopCaptureTracks() {
  processorNode?.disconnect();
  processorNode = null;
  void captureCtx?.close();
  captureCtx = null;
  mediaStream?.getTracks().forEach((t) => t.stop());
  mediaStream = null;
}

function beginTalk() {
  if (!ready || recording) return;
  recording = true;
  bytesSent = 0;
  els.talkBtn.classList.add("active");
  els.talkBtn.textContent = "Listening…";
  log("recording…");
}

function endTalk() {
  if (!recording) return;
  recording = false;
  els.talkBtn.classList.remove("active");
  els.talkBtn.textContent = "Hold to talk";

  const ms = (bytesSent / 2 / TARGET_RATE) * 1000;
  if (ms < MIN_COMMIT_MS) {
    log(`skip commit: only ${ms.toFixed(0)}ms (need ≥${MIN_COMMIT_MS}ms)`);
    return;
  }
  send({ type: "audio.commit" });
  log(`sent (${ms.toFixed(0)}ms)`);
}

function connect() {
  if (ws) {
    try {
      send({ type: "session.end" });
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }

  ready = false;
  els.talkBtn.disabled = true;
  setTextEnabled(false);
  const url = els.wsUrl.value.trim();
  setStatus("connecting…");
  log(`connect ${url}`);

  ws = new WebSocket(url);

  ws.onopen = () => {
    setStatus("connected", "ok");
    send({ type: "session.start" });
  };

  ws.onclose = () => {
    ready = false;
    els.talkBtn.disabled = true;
    setTextEnabled(false);
    setStatus("disconnected");
    log("socket closed");
  };

  ws.onerror = () => {
    setStatus("error", "err");
    log("socket error");
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case "ready":
        ready = true;
        els.talkBtn.disabled = false;
        setTextEnabled(true);
        setStatus("ready", "ok");
        log("session ready");
        break;
      case "transcript":
        log(`${msg.role}: ${msg.text}`);
        break;
      case "audio.delta":
        if (msg.audio) enqueuePcm16Base64(msg.audio);
        break;
      case "response.done":
        log("response.done");
        break;
      case "reminder.fired": {
        const r = msg.reminder;
        showToast("Напоминание", r?.text ?? "", r?.fire_at_local ?? "");
        log(`reminder.fired: ${r?.text ?? "?"}`);
        void refreshDebugReminders();
        break;
      }
      case "reminder.missed_digest": {
        const list = msg.reminders ?? [];
        const lines = list.map((r) => `• ${r.text} (${r.fire_at_local})`).join("\n");
        showToast(
          "Пропущенные напоминания",
          list.length === 0
            ? "Нет"
            : `Пока тебя не было, ${list.length}:\n${lines}`,
          "",
        );
        log(`reminder.missed_digest: ${list.length}`);
        void refreshDebugReminders();
        break;
      }
      case "error":
        setStatus("error", "err");
        log(`error: ${msg.message}`);
        break;
      default:
        break;
    }
  };
}

els.connectBtn.addEventListener("click", () => {
  void (async () => {
    try {
      if (!mediaStream) await startCapture();
      connect();
    } catch (err) {
      setStatus("mic error", "err");
      log(String(err));
    }
  })();
});

els.textForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!ready) return;
  const text = els.textInput.value.trim();
  if (!text) return;
  send({ type: "text", text });
  log(`you: ${text}`);
  els.textInput.value = "";
  els.textInput.focus();
});

els.debugRefreshBtn?.addEventListener("click", () => {
  void refreshDebugReminders();
});
els.debugRemindersDetails?.addEventListener("toggle", () => {
  syncDebugTimer();
});
syncDebugTimer();

const talk = els.talkBtn;
talk.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  talk.setPointerCapture(e.pointerId);
  beginTalk();
});
talk.addEventListener("pointerup", (e) => {
  e.preventDefault();
  endTalk();
});
talk.addEventListener("pointercancel", () => endTalk());
talk.addEventListener("lostpointercapture", () => endTalk());

window.addEventListener("beforeunload", () => {
  send({ type: "session.end" });
  stopCaptureTracks();
});
