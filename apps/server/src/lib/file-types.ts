/**
 * Content sniffing for uploaded files: the bytes must match the type the file
 * name claims (images, PDF). Types without a reliable signature pass; the
 * extension allow-list and the safe download headers cover them.
 */
export function looksLike(mime: string, b: Buffer): boolean {
  switch (mime) {
    case "image/jpeg":
      return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png":
      return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/gif":
      return b.length > 6 && (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a");
    case "image/webp":
      return b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
    case "image/heic":
    case "image/heif":
      return b.length > 12 && b.subarray(4, 8).toString("latin1") === "ftyp";
    case "application/pdf":
      return b.length > 5 && b.subarray(0, 5).toString("latin1") === "%PDF-";
    default:
      return true;
  }
}
