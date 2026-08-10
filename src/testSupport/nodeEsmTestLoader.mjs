// Node ESM loader hook used by src/services/cameras.test.ts, registered via
// node:module's register() before that test dynamically imports the real
// src/services/cameras.ts. This works around one genuine, well-known
// limitation of Node's native TypeScript execution (node --test running .ts
// files directly, with no jest/ts-node/bundler) — it does NOT change any
// behavior of the code under test:
//
// Node's ESM resolver requires FULL explicit specifiers (with extension) for
// relative imports (e.g. "./jaktlag" fails; "./jaktlag.ts" works), and has no
// built-in understanding of the "@/..." path alias this repo's bundler
// (Metro, via tsconfig "paths") resolves at build time. The resolve() hook
// below retries a failed extensionless/aliased specifier with ".ts"/".tsx"
// appended, purely so plain Node can find files that Metro/tsc already
// resolve fine for the app itself. See tsconfig.json's "paths" for the
// equivalent alias mapping used by the real toolchain.
//
// (An earlier version of this hook also patched a stray value-import of the
// `Unsubscribe` type; that has since been fixed at the source — see
// `import type { Unsubscribe } from "firebase/firestore"` in cameras.ts,
// mapPoints.ts and observations.ts — so only the resolution fallback below
// remains necessary.)

import { pathToFileURL } from "node:url";

const projectRoot = pathToFileURL(process.cwd() + "/").href;

async function resolveWithFallbackExtensions(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err && err.code === "ERR_MODULE_NOT_FOUND") {
      for (const ext of [".ts", ".tsx"]) {
        try {
          return await nextResolve(specifier + ext, context);
        } catch {
          // try next candidate
        }
      }
    }
    throw err;
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const rewritten = new URL(specifier.slice(2), projectRoot).href;
    return resolveWithFallbackExtensions(rewritten, context, nextResolve);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return resolveWithFallbackExtensions(specifier, context, nextResolve);
  }
  return nextResolve(specifier, context);
}
