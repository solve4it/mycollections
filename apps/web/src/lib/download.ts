/**
 * Saving a Blob the API sent as a file (#45). The name is the page's to choose —
 * `<a download>` ignores the server's `Content-Disposition` — so a collection's
 * name is cleaned here the way the server cleans it: control characters and the
 * characters some file system refuses become spaces, runs of space collapse, and
 * the result is capped so the saved name stays readable.
 */
export function exportFileName(name: string, date: Date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  const cleaned = [...name]
    .map((character) => (isUnsafeInFileName(character) ? " " : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `mycollections-${cleaned || "collection"}-${day}.zip`;
}

function isUnsafeInFileName(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f || '/\\:*?"<>|'.includes(character);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
