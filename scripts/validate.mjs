// Validates every sample against its schema: each file in samples/valid must pass, and each file in
// samples/invalid must fail (its $invalidBecause says why). Exits non-zero on any surprise, so CI is
// red both when the schema rejects a good manifest and when it lets a bad one through.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
// Strict, except strictRequired: it flags `required` in an if/then branch whose properties are
// declared at the top level, which is valid JSON Schema and the clearest way to say "if d3auth".
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
addFormats(ajv);
ajv.addKeyword({ keyword: "$invalidBecause" });
const validate = ajv.compile(read("schema/manifest.v1.schema.json"));
ajv.compile(read("schema/problem.schema.json"));

const registry = read("problems/registry.json");
const names = registry.types.map((t) => t.name);
let failures = 0;
if (new Set(names).size !== names.length) {
  console.error("problems/registry.json: duplicate problem name");
  failures++;
}

for (const [dir, shouldPass] of [["samples/valid", true], ["samples/invalid", false]]) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const sample = read(join(dir, file));
    const ok = validate(sample);
    if (ok === shouldPass) {
      console.log(`ok    ${dir}/${file}${shouldPass ? "" : ` — rejected: ${sample.$invalidBecause}`}`);
    } else {
      failures++;
      console.error(`FAIL  ${dir}/${file}: expected ${shouldPass ? "valid" : "invalid"}`);
      if (validate.errors) console.error(ajv.errorsText(validate.errors, { separator: "\n      " }));
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} sample(s) did not behave as expected`);
  process.exit(1);
}
console.log(`\nall samples behaved as expected; ${names.length} problem types registered`);
