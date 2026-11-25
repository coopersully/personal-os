// On web every URL belongs to the shared web UI, which the root web layout renders and which
// resolves its own unknown paths. An Expo Router miss renders nothing of its own.
export default function WebNotFound() {
  return null;
}
