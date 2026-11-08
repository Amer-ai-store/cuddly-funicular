// The shopper's chosen companion (Nira, Orion or Silk), kept on the device and shared by the home hero and the
// companion screen.
import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_COMPANION, companionById, isCompanionId, type CompanionId } from "./rafiq";

const COMPANION_KEY = "luqta-companion-v1";

export function useCompanion() {
  const [id, setId] = useState<CompanionId>(DEFAULT_COMPANION);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(COMPANION_KEY).then((saved) => { if (active && isCompanionId(saved)) setId(saved); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const choose = useCallback((next: CompanionId) => {
    setId(next);
    void AsyncStorage.setItem(COMPANION_KEY, next).catch(() => {});
  }, []);
  return { id, companion: companionById(id), choose };
}
