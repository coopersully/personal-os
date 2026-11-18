import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { SessionStorage } from "./session";

export function sessionStorage(origin: string): SessionStorage {
  const key = `personal-os.session.v1.${encodeURIComponent(origin).replace(/%/g, "_")}`;
  // The web preview intentionally keeps its token in memory, never localStorage.
  let memory: string | null = null;
  return {
    read: () => (Platform.OS === "web" ? Promise.resolve(memory) : SecureStore.getItemAsync(key)),
    write: async (token) => {
      if (Platform.OS === "web") {
        memory = token;
        return;
      }
      if (token)
        await SecureStore.setItemAsync(key, token, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      else await SecureStore.deleteItemAsync(key);
    },
  };
}
