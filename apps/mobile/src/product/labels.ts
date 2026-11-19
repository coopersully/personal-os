/** A stored kind or state as a person reads it: `follow_up` is "Follow up". */
export function storedLabel(value: string) {
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
