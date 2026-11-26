import test from "node:test";
import assert from "node:assert/strict";
import { validateIntegration } from "../coding/generator/integration.mjs";

const html = { id: "html", targetPath: "index.html", dependsOn: [] };
const js = { id: "js", targetPath: "app.js", dependsOn: ["html"] };
const plan = [html, js];
const document = '<html><body><button id="save"></button><script src="app.js"></script></body></html>';

test("planned HTML references and literal DOM IDs are checked", () => {
  assert.deepEqual(validateIntegration(html, document, [], plan), ["planned HTML asset references"]);
  assert.deepEqual(validateIntegration(js, 'document.getElementById("save");', [{ targetPath: "index.html", content: document }], plan), ["literal HTML element IDs"]);
  assert.throws(() => validateIntegration(js, 'document.getElementById("missing");', [{ targetPath: "index.html", content: document }], plan), /absent/);
  assert.throws(() => validateIntegration(html, '<html><body><script src="missing.js"></script></body></html>', [], plan), /not in the project plan/);
});

test("identical inline and external scripts are detected", () => {
  const code = 'document.getElementById("save").textContent = "ok";';
  const content = '<html><body><button id="save"></button><script>' + code + '</script></body></html>';
  assert.throws(() => validateIntegration(js, code, [{ targetPath: "index.html", content }], plan), /duplicates/);
});

test("relative imports must reference planned dependencies", () => {
  const source = { id: "shared", targetPath: "src/shared.js", dependsOn: [] };
  const target = { id: "main", targetPath: "src/main.js", dependsOn: ["shared"] };
  assert.doesNotThrow(() => validateIntegration(target, 'import { x } from "./shared.js";', [], [source, target]));
  assert.throws(() => validateIntegration({ ...target, dependsOn: [] }, 'import { x } from "./shared.js";', [], [source, target]), /dependency/);
  assert.throws(() => validateIntegration(target, 'import { x } from "../../outside.js";', [], [source, target]), /path/);
  const refs = [{ targetPath: "src/shared.js", content: "export const x = 1;" }];
  assert.doesNotThrow(() => validateIntegration(target, 'import { x } from "./shared.js";', refs, [source, target]));
  assert.throws(() => validateIntegration(target, 'import { missing } from "./shared.js";', refs, [source, target]), /absent/);
});
