import path from "node:path";
import { validateTarget } from "./plan.mjs";

function resolveReference(from, value, planned) {
  if (!value || value.startsWith("#") || /^(?:https?:|data:|\/\/)/i.test(value)) return null;
  const clean = value.split(/[?#]/, 1)[0];
  if (!clean || clean.startsWith("/") || clean.includes("\\") || /^[a-z]+:/i.test(clean)) throw new Error("Unsafe local reference: " + value);
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), clean));
  validateTarget(target);
  const choices = [target, target + ".js", target + ".mjs", target + ".json", target + "/index.js"];
  const match = planned.find(t => choices.some(choice => t.targetPath.toLowerCase() === choice.toLowerCase()));
  if (!match) throw new Error("Referenced local file is not in the project plan: " + value);
  return match;
}

// These are deliberately narrow static checks, not an HTML or JavaScript parser.
export function validateIntegration(def, code, refs, planned) {
  const checked = [];
  if (/\.html?$/i.test(def.targetPath) && /<html\b/i.test(code)) {
    for (const match of code.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) resolveReference(def.targetPath, match[1], planned);
    for (const match of code.matchAll(/<link\b(?=[^>]*\brel\s*=\s*["']stylesheet["'])[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) resolveReference(def.targetPath, match[1], planned);
    checked.push("planned HTML asset references");
  }
  if (/\.(?:js|mjs|cjs)$/i.test(def.targetPath)) {
    for (const match of code.matchAll(/\bfrom\s*["'](\.[^"']+)["']/g)) {
      const target = resolveReference(def.targetPath, match[1], planned);
      if (target && !def.dependsOn.includes(target.id)) throw new Error("Relative import is not a declared task dependency: " + match[1]);
    }
    for (const match of code.matchAll(/\bimport\s*\{([^}]+)\}\s*from\s*["'](\.[^"']+)["']/g)) {
      const target = resolveReference(def.targetPath, match[2], planned);
      const source = target && refs.find(ref => ref.targetPath.toLowerCase() === target.targetPath.toLowerCase());
      // Wildcard re-exports, CommonJS, destructuring, and comma declarations require a real parser.
      if (!source || /\bexport\s*\*|\bmodule\.exports\b|\bexport\s+(?:const|let|var)\s*[{[]|\bexport\s+(?:const|let|var)[^;\n]*,/.test(source.content)) continue;
      const exports = new Set();
      for (const named of source.content.matchAll(/\bexport\s+(?:async\s+)?(?:const|let|var|class|function)\s+([A-Za-z_$][\w$]*)/g)) exports.add(named[1]);
      for (const list of source.content.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
        for (const item of list[1].split(",")) {
          const parts = item.trim().split(/\s+as\s+/);
          if (parts[0]) exports.add(parts[1] || parts[0]);
        }
      }
      if (/\bexport\s+default\b/.test(source.content)) exports.add("default");
      for (const item of match[1].split(",")) {
        const imported = item.trim().split(/\s+as\s+/)[0];
        if (/^[A-Za-z_$][\w$]*$/.test(imported) && !exports.has(imported)) throw new Error("Named import is absent from supplied module context: " + imported);
      }
      checked.push("simple named imports and exports");
    }
    const htmlRefs = refs.filter(r => /\.html?$/i.test(r.targetPath) && /<html\b/i.test(r.content));
    if (htmlRefs.length && !/\bcreateElement\s*\(/.test(code)) {
      for (const match of code.matchAll(/\bgetElementById\s*\(\s*["']([^"']+)["']\s*\)/g)) {
        const exists = htmlRefs.some(ref => [...ref.content.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].some(id => id[1] === match[1]));
        if (!exists) throw new Error("Referenced HTML ID is absent from supplied context: " + match[1]);
      }
      checked.push("literal HTML element IDs");
    }
    for (const html of htmlRefs) {
      for (const match of html.content.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
        const inline = match[1].replace(/\s+/g, "");
        if (inline.length >= 20 && inline === code.replace(/\s+/g, "")) throw new Error("JavaScript duplicates an inline HTML script.");
      }
    }
  }
  return checked;
}
