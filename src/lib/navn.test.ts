import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { utledNavnFraEpost } = await import("./navn");

test("utledNavnFraEpost: enkelt navn.etternavn blir 'Navn Etternavn'", () => {
  assert.equal(utledNavnFraEpost("glennove.karlsen@gmail.com"), "Glennove Karlsen");
});

test("utledNavnFraEpost: bindestrek og understrek splittes som punktum", () => {
  assert.equal(utledNavnFraEpost("ola-nordmann@viltiq.no"), "Ola Nordmann");
  assert.equal(utledNavnFraEpost("kari_hansen@viltiq.no"), "Kari Hansen");
});

test("utledNavnFraEpost: enkeltord uten separator kapitaliseres", () => {
  assert.equal(utledNavnFraEpost("jeger1@viltiq.no"), "Jeger1");
});

test("utledNavnFraEpost: tom/ugyldig e-post faller tilbake til 'Jeger'", () => {
  assert.equal(utledNavnFraEpost(""), "Jeger");
});
