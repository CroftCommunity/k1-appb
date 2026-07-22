// account-kernel K1 — app skin (throwaway spike). Embeds the kernel iframe and drives the probe.
// The kernel origin is derived by swapping this page's FIRST hostname label for "kernel", so the
// harness runs unchanged locally (app-a.localhost -> kernel.localhost) and on real domains
// (app-a.croft.ing -> kernel.croft.ing).

const PROBE_KEY = "k1-probe";
const logEl = document.getElementById("log");
const verdictEl = document.getElementById("verdict");

function log(...a) {
  const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  logEl.textContent += line + "\n";
  // eslint-disable-next-line no-console
  console.log("[app]", ...a);
}
function setVerdict(text, cls) {
  verdictEl.textContent = text;
  verdictEl.className = "verdict " + cls;
}

// Kernel origin: explicit window.KERNEL_ORIGIN (set by a deploy) wins; otherwise derive it
// by swapping this page's first hostname label for "kernel" (works for *.localhost locally).
const derivedKernelOrigin = (() => {
  const labels = location.hostname.split(".");
  const kernelHost = ["kernel", ...labels.slice(1)].join(".");
  return `${location.protocol}//${kernelHost}${location.port ? ":" + location.port : ""}`;
})();
const kernelOrigin = window.KERNEL_ORIGIN || derivedKernelOrigin;
document.getElementById("kernelOrigin").textContent = kernelOrigin;

const iframe = document.getElementById("kernel");
iframe.src = `${kernelOrigin}/kernel/`;

// --- postMessage RPC to the kernel iframe ---
let seq = 0;
const pending = new Map();
window.addEventListener("message", (e) => {
  if (e.origin !== kernelOrigin) return; // only trust the kernel origin
  const msg = e.data || {};
  if (msg.ready) { log("kernel ready:", msg.kernelOrigin); return; }
  const p = pending.get(msg.id);
  if (p) { pending.delete(msg.id); p(msg.result); }
});
function rpc(op, key, val) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, resolve);
    iframe.contentWindow.postMessage({ id, op, key, val }, kernelOrigin);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("rpc timeout")); } }, 4000);
  });
}

document.getElementById("whoami").onclick = async () => {
  const r = await rpc("whoami").catch((e) => ({ error: String(e) }));
  log("whoami ->", r);
  setVerdict(`kernel origin ${r.origin || "?"} · secureContext=${r.secureContext} · this page ${location.origin}`, "info");
};

document.getElementById("write").onclick = async () => {
  // Date.now()/Math.random() are fine in browser JS (only blocked in Workflow scripts).
  const nonce = `${location.hostname}@${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const r = await rpc("write", PROBE_KEY, nonce).catch((e) => ({ error: String(e) }));
  log("write ->", r);
  setVerdict(`Wrote nonce via kernel: ${nonce}\nNow open the OTHER subdomain and click Read nonce.`, "info");
};

document.getElementById("read").onclick = async () => {
  const r = await rpc("read", PROBE_KEY).catch((e) => ({ error: String(e) }));
  log("read ->", r);
  const fromOther = (v) => typeof v === "string" && !v.startsWith(location.hostname + "@");
  const sharedIdb = fromOther(r.idb);
  const sharedOpfs = fromOther(r.opfs);
  if (sharedIdb || sharedOpfs) {
    setVerdict(
      `H1 PASS — kernel storage is SHARED across subdomains.\n` +
      `  IndexedDB: ${sharedIdb ? "shared ✓ (" + r.idb + ")" : "not shared (" + r.idb + ")"}\n` +
      `  OPFS:      ${sharedOpfs ? "shared ✓ (" + r.opfs + ")" : "not shared (" + r.opfs + ")"}`,
      "pass",
    );
  } else if (r.idb == null && r.opfs == null) {
    setVerdict(
      `H1 FAIL (or nothing written yet) — this subdomain's kernel sees EMPTY storage.\n` +
      `If app-a already wrote, empty here means storage is PARTITIONED per top-level site.`,
      "fail",
    );
  } else {
    setVerdict(
      `Read own-origin value only (idb=${r.idb}, opfs=${r.opfs}). Write from the OTHER subdomain, then read here.`,
      "info",
    );
  }
};

log("app skin loaded:", location.origin, "-> kernel", kernelOrigin);
