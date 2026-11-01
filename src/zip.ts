// Minimal ZIP writer (stored entries, no compression). Enough for .vsix packages,
// without pulling a packaging tool from the internet at install time.
export function createZip(files: { path: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder()
  const local: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  // Fixed timestamp (1980-01-01) so the same input always gives the same bytes.
  const dosTime = 0
  const dosDate = (0 << 9) | (1 << 5) | 1
  for (const f of files) {
    const name = enc.encode(f.path)
    const crc = Bun.hash.crc32(f.data) >>> 0
    const size = f.data.length
    const header = new DataView(new ArrayBuffer(30))
    header.setUint32(0, 0x04034b50, true)
    header.setUint16(4, 20, true) // version needed
    header.setUint16(6, 0x0800, true) // UTF-8 names
    header.setUint16(8, 0, true) // stored
    header.setUint16(10, dosTime, true)
    header.setUint16(12, dosDate, true)
    header.setUint32(14, crc, true)
    header.setUint32(18, size, true)
    header.setUint32(22, size, true)
    header.setUint16(26, name.length, true)
    header.setUint16(28, 0, true)
    local.push(new Uint8Array(header.buffer), name, f.data)

    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, dosTime, true)
    c.setUint16(14, dosDate, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, size, true)
    c.setUint32(24, size, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    central.push(new Uint8Array(c.buffer), name)
    offset += 30 + name.length + size
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  const parts = [...local, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0))
  let pos = 0
  for (const p of parts) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}
