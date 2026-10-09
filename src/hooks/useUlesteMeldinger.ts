// Delt "hvor mange uleste chatmeldinger har jeg"-abonnement — brukt av
// BottomDock (Chat-fanens badge) OG Hjem (chat-/varsel-ikonene i headeren),
// slik at de to alltid viser samme tall i stedet for to uavhengige
// beregninger som kan drifte fra hverandre.

import { useEffect, useState } from "react";
import { auth } from "@/src/config/firebase";
import { getAktivtJaktlagId } from "@/src/services/jaktlag";
import { hentSistLest, subscribeToChatMeldinger, tellUlesteMeldinger } from "@/src/services/chat";

export function useUlesteMeldinger(): number {
  const [uleste, setUleste] = useState(0);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let aktiv = true;

    (async () => {
      const jaktlagId = await getAktivtJaktlagId();
      if (!aktiv || !jaktlagId) return;
      const sistLest = await hentSistLest(jaktlagId);
      if (!aktiv) return;
      unsub = subscribeToChatMeldinger(jaktlagId, (meldinger) => {
        if (aktiv) setUleste(tellUlesteMeldinger(meldinger, sistLest, auth.currentUser?.uid));
      });
    })();

    return () => { aktiv = false; unsub?.(); };
  }, []);

  return uleste;
}
