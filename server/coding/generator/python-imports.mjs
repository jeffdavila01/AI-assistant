import { spawn } from "node:child_process";
import path from "node:path";

// Only this fixed program is executed. Generated Python is supplied on stdin and
// parsed as data; it is never imported, compiled to disk, or run.
const INSPECTOR = `import ast,json,sys
try:
 tree=ast.parse(sys.stdin.buffer.read().decode('utf-8'), filename='<generated>')
 imports=[]
 for node in ast.walk(tree):
  if isinstance(node, ast.Import):
   imports.extend({'module': a.name, 'level': 0, 'names': []} for a in node.names)
  elif isinstance(node, ast.ImportFrom):
   imports.append({'module': node.module or '', 'level': node.level, 'names': [a.name for a in node.names]})
  if len(imports)>1000: raise ValueError('too many imports')
 print(json.dumps(imports))
except SyntaxError as e:
 print('line '+str(e.lineno or 0), file=sys.stderr)
 sys.exit(1)
except (ValueError,UnicodeError,RecursionError):
 sys.exit(1)`;

function readImports(code, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn("python", ["-I", "-S", "-c", INSPECTOR], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", stderr = "", failure, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value);
    };
    const stop = error => { failure ||= error; child.kill(); };
    const abort = () => stop(signal.reason || new Error("Python import validation cancelled."));
    const timer = setTimeout(() => stop(new Error("Python import validation timed out.")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", chunk => {
      output += chunk.toString("utf8");
      if (output.length > 200000) stop(new Error("Python import validation output exceeded its limit."));
    });
    child.stderr.on("data", chunk => { if (stderr.length < 100) stderr += chunk.toString("utf8"); });
    child.stdin.on("error", () => {});
    child.on("error", () => finish(failure || new Error("Python import validator unavailable.")));
    child.on("close", code => {
      if (failure) return finish(failure);
      if (code !== 0) {
        const line = /^line \d+\s*$/.test(stderr) ? ": " + stderr.trim() : "";
        return finish(new Error("Python import validation could not parse the source" + line));
      }
      try { finish(null, JSON.parse(output)); }
      catch { finish(new Error("Python import validation returned invalid output.")); }
    });
    child.stdin.end(code, "utf8");
  });
}

// This checks dependencies only for unambiguously planned local modules. It is
// deliberately not an import resolver: external and dynamic imports remain
// unverified, as do attributes, runtime availability and optional imports.
export async function validatePythonImports(def, code, planned, { signal, timeoutMs = 10000 } = {}) {
  if (!/\.py$/i.test(def.targetPath)) return [];
  if (typeof code !== "string" || code.length > 50000) throw new Error("Invalid or oversized Python source.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new Error("Invalid Python import validation timeout.");
  const modules = new Map();
  for (const task of planned) {
    if (!/\.py$/i.test(task.targetPath)) continue;
    const name = task.targetPath.replace(/\.py$/i, "").replace(/\/__init__$/, "").replaceAll("/", ".");
    if (!modules.has(name)) modules.set(name, []);
    modules.get(name).push(task);
  }
  const imports = await readImports(code, signal, timeoutMs);
  const checked = new Set();
  const requireDeclared = module => {
    const matches = modules.get(module) || [];
    for (const match of matches) {
      if (match.id !== def.id && !def.dependsOn.includes(match.id)) {
        throw new Error("Python planned local import is not a declared task dependency: " + module);
      }
      checked.add(match.id);
    }
    return matches.length > 0;
  };
  for (const entry of imports) {
    let module = entry.module;
    if (entry.level) {
      const parts = path.posix.dirname(def.targetPath).split("/").filter(p => p !== ".");
      if (entry.level > parts.length) throw new Error("Python relative import escapes the project package.");
      parts.splice(parts.length - (entry.level - 1), entry.level - 1);
      module = [...parts, ...(module ? module.split(".") : [])].join(".");
    }
    let resolved = module ? requireDeclared(module) : false;
    for (const name of entry.names) {
      if (name === "*") continue;
      const child = [module, name].filter(Boolean).join(".");
      resolved = requireDeclared(child) || resolved;
    }
    if (entry.level && !resolved) throw new Error("Python relative import is not in the project plan.");
  }
  return checked.size ? ["planned Python local import dependencies"] : [];
}
