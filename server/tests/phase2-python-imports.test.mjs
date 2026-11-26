import test from "node:test";
import assert from "node:assert/strict";
import { validatePythonImports } from "../coding/generator/python-imports.mjs";

const plan = [
  { id: "storage", targetPath: "storage.py", dependsOn: [] },
  { id: "inventory", targetPath: "inventory.py", dependsOn: ["storage"] },
  { id: "tests", targetPath: "tests/test_inventory.py", dependsOn: ["inventory"] },
  { id: "pkg", targetPath: "pkg/__init__.py", dependsOn: [] },
  { id: "pkgutils", targetPath: "pkg/utils.py", dependsOn: [] },
  { id: "pkgmain", targetPath: "pkg/main.py", dependsOn: ["pkg", "pkgutils"] }
];
const inventory = plan[1];

test("recognizes static local imports and aliases without running source", async () => {
  const code = "raise RuntimeError('this generated source must never run')\nimport storage as persistence\nfrom storage import Store as S\n";
  assert.deepEqual(await validatePythonImports(inventory, code, plan), ["planned Python local import dependencies"]);
});

test("rejects undeclared planned local imports", async () => {
  await assert.rejects(validatePythonImports({ ...inventory, dependsOn: [] }, "from storage import Store\n", plan), /not a declared task dependency/);
});

test("resolves relative module and package imports against the planned files", async () => {
  assert.deepEqual(await validatePythonImports(plan[5], "from .utils import helper\nfrom . import utils\n", plan), ["planned Python local import dependencies"]);
  await assert.rejects(validatePythonImports(plan[5], "from .missing import value\n", plan), /not in the project plan/);
  await assert.rejects(validatePythonImports(plan[5], "from ..outside import value\n", plan), /escapes the project package/);
  await assert.rejects(validatePythonImports(plan[5], "from ...outside import value\n", plan), /escapes the project package/);
  await assert.rejects(validatePythonImports(inventory, "from .storage import value\n", plan), /escapes the project package/);
});

test("does not invent guarantees for unknown, dynamic, or comment-only imports", async () => {
  const code = "# import storage\ntext = 'import storage'\nimport external_unknown\n__import__('storage')\n";
  assert.deepEqual(await validatePythonImports({ ...inventory, dependsOn: [] }, code, plan), []);
});

test("does not execute malformed source and handles cancellation", async () => {
  await assert.rejects(validatePythonImports(inventory, "if :\n", plan), /could not parse/);
  const controller = new AbortController();
  controller.abort(new Error("cancelled for test"));
  await assert.rejects(validatePythonImports(inventory, "import storage\n", plan, { signal: controller.signal }), /cancelled for test/);
});
