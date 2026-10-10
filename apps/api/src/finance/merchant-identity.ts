export function titleCaseMerchant(value: string) {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\b(Usa|Llc|Inc|Ny|Ca)\b/g, (word) => word.toUpperCase());
}

export function normalizedMerchant(merchant: string) {
  return merchant
    .toLowerCase()
    .replace(/[*#]\d+\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
