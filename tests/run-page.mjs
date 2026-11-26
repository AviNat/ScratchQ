/*
 * Runs a test page of this folder in headless Edge and prints its result.
 *
 *   node tests/run-page.mjs tests/runner-tests.html [timeoutSeconds]
 *
 * The page sets window.__done = true and window.__result = { passed, failed, lines: [..] } when it is finished.
 * A small static server serves the ScratchQ folder (ES modules need http, not file://); the libraries from the
 * CDN need the network. Exit code 0 only when nothing failed.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = process.argv[2] || "tests/runner-tests.html";
const timeout = (Number(process.argv[3]) || 120) * 1000;
const EDGE = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find(p => fs.existsSync(p));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".scratchq": "application/json" };

const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/${page}`;

const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "scratchq-edge-"));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--disable-extensions", "--window-size=1400,1000", "about:blank"], { stdio: "ignore" });

function done(code) {
    try { edge.kill(); } catch (e) { /* ignore */ }
    server.close();
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* busy */ } process.exit(code); }, 500);
}
setTimeout(() => { console.log("TIMEOUT"); done(2); }, timeout + 20000);

async function json(p) {
    for (let i = 0; i < 100; i += 1) {
        try { const r = await fetch(`http://127.0.0.1:${port}${p}`); return await r.json(); } catch (e) { await new Promise(r => setTimeout(r, 200)); }
    }
    throw new Error("Edge did not start");
}
const targets = await json("/json/list");
const target = targets.find(t => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled" && process.env.SHOW_CONSOLE) {
        console.log("  [console." + m.params.type + "] " + m.params.args.map(a => a.value !== undefined ? a.value : a.description).join(" "));
    }
    if (m.method === "Page.javascriptDialogOpening") {
        /* alert / confirm / prompt block the page: print and accept them */
        console.log("  [" + m.params.type + "] " + m.params.message.replace(/\n/g, " / "));
        ws.send(JSON.stringify({ id: 999999, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
    }
    if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        console.log("  [exception] " + (d.exception && d.exception.description || d.text));
    }
});
const send = (method, params) => new Promise(r => { id += 1; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expr => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url });
const t0 = Date.now();
while (Date.now() - t0 < timeout) {
    if (await evaluate("window.__done === true")) break;
    await new Promise(r => setTimeout(r, 300));
}
if (process.env.SHOT) {
    /* SHOT=file.png: a screenshot of the page as it is at the end */
    const params = { format: "png" };
    if (process.env.FULL) {
        /* FULL=1: the whole page, not only the window */
        const m = (await send("Page.getLayoutMetrics")).result;
        const size = m.cssContentSize || m.contentSize;
        params.captureBeyondViewport = true;
        params.clip = { x: 0, y: 0, width: size.width, height: Math.min(size.height, 6000), scale: 0.7 };
    }
    const shot = await send("Page.captureScreenshot", params);
    if (shot.result && shot.result.data) fs.writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, "base64"));
}
const result = await evaluate("JSON.stringify(window.__result || null)");
if (!result) { console.log("The page did not finish (" + url + ")"); done(2); }
else {
    const r = JSON.parse(result);
    (r.lines || []).forEach(l => console.log(l));
    console.log(`passed ${r.passed}, failed ${r.failed}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    done(r.failed ? 1 : 0);
}
