// Node ESM loader hooks used ONLY by src/services/cameras.test.ts, registered
// via node:module's register() before that test dynamically imports the real
// src/services/cameras.ts. This file exists to work around two genuine,
// well-known limitations of Node's native TypeScript execution (node --test
// running .ts files directly, with no jest/ts-node/bundler) — it does NOT
// change any behavior of the code under test:
//
// 1. Node's ESM resolver requires FULL explicit specifiers (with extension)
//    for relative imports (e.g. "./jaktlag" fails; "./jaktlag.ts" works),
//    and has no built-in understanding of the "@/..." path alias this repo's
//    bundler (Metro, via tsconfig "paths") resolves at build time. The
//    resolve() hook below retries a failed extensionless/aliased specifier
//    with ".ts"/".tsx" appended, purely so plain Node can find files that
//    Metro/tsc already resolve fine for the app itself.
//
// 2. cameras.ts (and its dependency jaktlag.ts) import the TYPE
//    `Unsubscribe` from "firebase/firestore" as a normal named import
//    (`import { ..., Unsubscribe, ... } from "firebase/firestore"`) rather
//    than `import type { Unsubscribe }`. Node's type-stripping (and even
//    --experimental-transform-types) only erases TYPE SYNTAX (annotations,
//    interfaces, etc.) — it cannot know, without full type-checking, that a
//    named import is used solely as a type, so it leaves the import as-is.
//    Firebase does not export a runtime value called `Unsubscribe`, so
//    evaluating the untouched file crashes with
//    "SyntaxError: The requested module 'firebase/firestore' does not
//    provide an export named 'Unsubscribe'". The load() hook below removes
//    that one dead identifier from the import list of the IN-MEMORY module
//    text Node evaluates, after Node has already done its normal type
//    stripping — the actual files on disk are never touched, and
//    normaliserGrader()'s logic/behavior is completely unaffected (it does
//    not reference Unsubscribe at all).
//
// This is intentionally narrow: it only rewrites resolution for relative/
// aliased specifiers, and only patches the source of files whose path ends
// in "cameras.ts" or "jaktlag.ts". See tsconfig.json's "paths" for the
// equivalent alias mapping used by the real toolchain.

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

const FILES_WITH_TYPE_ONLY_UNSUBSCRIBE_IMPORT = ["cameras.ts", "jaktlag.ts"];

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);

  const needsPatch = FILES_WITH_TYPE_ONLY_UNSUBSCRIBE_IMPORT.some((name) =>
    url.endsWith("/" + name)
  );
  if (!needsPatch || typeof result.source === "undefined") {
    return result;
  }

  let src = result.source.toString();
  const patched = src.replace(/\n(\s*)Unsubscribe,\n/, "\n");
  if (patched === src) {
    return result;
  }
  return { ...result, source: patched };
}
