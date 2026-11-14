/**
 * Whether a chosen file is a zip (#45), by its first bytes — `PK\x03\x04` —
 * rather than a name or a type the browser guessed, which varies by platform
 * (`application/zip`, `application/x-zip-compressed`, or nothing at all).
 */
export async function isZipFile(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head.length === 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}
