// ============================================================
// pyworker.js — Pyodide 를 Web Worker 에서 실행
//   · 메인 스레드와 분리 → 무한 루프여도 UI 안 멈춤, terminate() 로 강제 종료 가능
//   · 생성 시 Pyodide 로드 시작 → 완료되면 {type:"ready"} 전송
//   · {type:"run", id, code, stdin} 수신 → 실행 후 {id, ok, output} 전송
// ============================================================

const PYODIDE_VER = "v0.26.4";
const BASE = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VER}/full/`;

const pyReady = (async () => {
  importScripts(BASE + "pyodide.js");
  const py = await loadPyodide({ indexURL: BASE });
  self.postMessage({ type: "ready" });
  return py;
})().catch((err) => {
  self.postMessage({ type: "loaderror", error: String((err && err.message) || err) });
  throw err;
});

const PREAMBLE =
  "import builtins\n" +
  "_it = iter(_stdin_lines)\n" +
  "def _inp(prompt=''):\n" +
  "    if prompt: print(prompt, end='')\n" +
  "    try:\n" +
  "        return next(_it)\n" +
  "    except StopIteration:\n" +
  "        return ''\n" +
  "builtins.input = _inp\n";

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg || msg.type !== "run") return;
  const { id, code, stdin } = msg;
  try {
    const py = await pyReady;
    let out = "";
    py.setStdout({ batched: (s) => { out += s + "\n"; } });
    py.setStderr({ batched: (s) => { out += s + "\n"; } });
    const lines = stdin && stdin.length ? String(stdin).replace(/\r\n/g, "\n").split("\n") : [];
    py.globals.set("_stdin_lines", py.toPy(lines));
    try {
      await py.runPythonAsync(PREAMBLE + code);
    } catch (err) {
      out += String((err && err.message) || err);
    }
    self.postMessage({ id, ok: true, output: out });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
