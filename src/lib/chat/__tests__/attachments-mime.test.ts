import { sniffAndValidateMime, ALLOWED_ATTACHMENT_MIMES } from "@/lib/chat/attachments";

function makeFileLike(name: string, type: string, content: Uint8Array): {
  name: string;
  type: string;
  size: number;
  slice: (start: number, end: number) => Blob;
} {
  // Envolvemos o Uint8Array em um ArrayBuffer novo para evitar
  // problemas de tipo com Blob (Uint8Array<ArrayBufferLike> nao e
  // aceito em algumas versoes de TS DOM lib).
  const buf = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
  const blob = new Blob([buf], { type });
  return {
    name,
    type,
    size: content.length,
    slice: (start, end) => blob.slice(start, end),
  };
}

// Magic bytes conhecidos para testes. Cada tipo precisa de magic bytes
// suficientes para que o sniffer reconheca com confianca.
// PNG: \x89PNG\r\n\x1a\n + IHDR chunk (13 bytes min)
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);
// JPEG: FF D8 FF E0 + JFIF
const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00,
]);
// PDF: %PDF-1.4\n
const PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34,
  0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a, 0x00,
]);
// MZ (Windows .exe)
const EXE_BYTES = new Uint8Array([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00,
  0x04, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00,
]);

describe("ALLOWED_ATTACHMENT_MIMES", () => {
  it("includes common image formats", () => {
    expect(ALLOWED_ATTACHMENT_MIMES).toContain("image/jpeg");
    expect(ALLOWED_ATTACHMENT_MIMES).toContain("image/png");
    expect(ALLOWED_ATTACHMENT_MIMES).toContain("image/webp");
  });

  it("includes PDF", () => {
    expect(ALLOWED_ATTACHMENT_MIMES).toContain("application/pdf");
  });

  it("includes text formats", () => {
    expect(ALLOWED_ATTACHMENT_MIMES).toContain("text/plain");
    expect(ALLOWED_ATTACHMENT_MIMES).toContain("text/markdown");
    expect(ALLOWED_ATTACHMENT_MIMES).toContain("text/csv");
  });

  it("does NOT include executable or archive types", () => {
    expect(ALLOWED_ATTACHMENT_MIMES).not.toContain("application/x-msdownload");
    expect(ALLOWED_ATTACHMENT_MIMES).not.toContain("application/zip");
    expect(ALLOWED_ATTACHMENT_MIMES).not.toContain("application/x-executable");
  });
});

describe("sniffAndValidateMime", () => {
  it("detects PNG even when client claims image/jpeg", async () => {
    const file = makeFileLike("evil.jpg", "image/jpeg", PNG_BYTES);
    const result = await sniffAndValidateMime(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mime).toBe("image/png");
      expect(result.source).toBe("sniffed");
    }
  });

  it("detects real JPEG and accepts it", async () => {
    const file = makeFileLike("photo.jpg", "image/jpeg", JPEG_BYTES);
    const result = await sniffAndValidateMime(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mime).toBe("image/jpeg");
    }
  });

  it("detects PDF and accepts it", async () => {
    const file = makeFileLike("doc.pdf", "application/pdf", PDF_BYTES);
    const result = await sniffAndValidateMime(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mime).toBe("application/pdf");
    }
  });

  it("REJECTS an .exe renamed to .jpg (magic bytes are MZ)", async () => {
    const file = makeFileLike("virus.jpg", "image/jpeg", EXE_BYTES);
    const result = await sniffAndValidateMime(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detectedMime).toBeDefined();
      // O detector do file-type classifica MZ como application/x-msdownload
      expect(result.reason).toMatch(/nao permitido|detectado/i);
    }
  });

  it("rejects executable files sniffed as their detected type", async () => {
    const file = makeFileLike("payload.bin", "application/octet-stream", EXE_BYTES);
    const result = await sniffAndValidateMime(file);
    expect(result.ok).toBe(false);
  });

  it("accepts plain text by claimed MIME (text/plain has no magic bytes)", async () => {
    const text = new TextEncoder().encode("hello world\n");
    const file = makeFileLike("notes.txt", "text/plain", text);
    const result = await sniffAndValidateMime(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mime).toBe("text/plain");
      expect(result.source).toBe("claimed-text");
    }
  });

  it("accepts JSON by claimed MIME", async () => {
    const json = new TextEncoder().encode('{"hello":"world"}');
    const file = makeFileLike("data.json", "application/json", json);
    const result = await sniffAndValidateMime(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mime).toBe("application/json");
    }
  });

  it("rejects unknown binary content with application/octet-stream claim", async () => {
    const weird = new Uint8Array([0x42, 0x42, 0x42, 0x42, 0x42, 0x42]);
    const file = makeFileLike("weird.bin", "application/octet-stream", weird);
    const result = await sniffAndValidateMime(file);
    expect(result.ok).toBe(false);
  });

  it("rejects application/zip (commonly used for malware delivery)", async () => {
    // PK\x03\x04 = zip local file header
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const file = makeFileLike("archive.zip", "application/zip", zip);
    const result = await sniffAndValidateMime(file);
    expect(result.ok).toBe(false);
  });

  it("handles empty files gracefully (only if claimed mime is allowed text)", async () => {
    const empty = new Uint8Array([]);
    const fileText = makeFileLike("empty.txt", "text/plain", empty);
    expect((await sniffAndValidateMime(fileText)).ok).toBe(true);

    const fileBin = makeFileLike("empty.bin", "application/octet-stream", empty);
    expect((await sniffAndValidateMime(fileBin)).ok).toBe(false);
  });
});