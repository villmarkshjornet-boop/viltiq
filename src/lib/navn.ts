// Utleder et lesbart visningsnavn fra en e-postadresse når brukeren ikke har
// satt et eget ("glennove.karlsen@gmail.com" → "Glennove Karlsen"). Delt
// mellom src/services/jaktlag.ts (medlemskap) og src/services/profile.ts
// (kanonisk brukerprofil) — ren funksjon, ingen Firestore-avhengighet.

export function utledNavnFraEpost(epost: string): string {
  const lokalDel = epost.split("@")[0] ?? epost;
  const ord = lokalDel
    .split(/[._-]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1));
  return ord.length > 0 ? ord.join(" ") : "Jeger";
}
