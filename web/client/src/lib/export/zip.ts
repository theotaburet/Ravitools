// ---------------------------------------------------------------------------
// Minimal ZIP builder (STORE method, single file)
// Builds a valid ZIP archive for a single uncompressed file.
// This avoids any dependency on jszip or fflate for the simple KMZ case.
// See: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
// ---------------------------------------------------------------------------

export function buildZipSingleFile(filename: string, data: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(filename);
  const crc = crc32(data);
  const size = data.length;

  // DOS date/time for "now"
  const now = new Date();
  const dosTime =
    ((now.getSeconds() >> 1) & 0x1f) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getHours() & 0x1f) << 11);
  const dosDate =
    (now.getDate() & 0x1f) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (((now.getFullYear() - 1980) & 0x7f) << 9);

  // Local file header (30 + nameLen)
  const lfhSize = 30 + nameBytes.length;
  const lfh = new Uint8Array(lfhSize);
  const lfhView = new DataView(lfh.buffer);
  lfhView.setUint32(0, 0x04034b50, true); // local file header signature
  lfhView.setUint16(4, 20, true); // version needed to extract
  lfhView.setUint16(6, 0, true); // general purpose bit flag
  lfhView.setUint16(8, 0, true); // compression method (STORE)
  lfhView.setUint16(10, dosTime, true); // last mod file time
  lfhView.setUint16(12, dosDate, true); // last mod file date
  lfhView.setUint32(14, crc, true); // crc-32
  lfhView.setUint32(18, size, true); // compressed size
  lfhView.setUint32(22, size, true); // uncompressed size
  lfhView.setUint16(26, nameBytes.length, true); // file name length
  lfhView.setUint16(28, 0, true); // extra field length
  lfh.set(nameBytes, 30);

  // Central directory header (46 + nameLen)
  const cdhSize = 46 + nameBytes.length;
  const cdh = new Uint8Array(cdhSize);
  const cdhView = new DataView(cdh.buffer);
  cdhView.setUint32(0, 0x02014b50, true); // central directory file header signature
  cdhView.setUint16(4, 20, true); // version made by
  cdhView.setUint16(6, 20, true); // version needed to extract
  cdhView.setUint16(8, 0, true); // general purpose bit flag
  cdhView.setUint16(10, 0, true); // compression method (STORE)
  cdhView.setUint16(12, dosTime, true); // last mod file time
  cdhView.setUint16(14, dosDate, true); // last mod file date
  cdhView.setUint32(16, crc, true); // crc-32
  cdhView.setUint32(20, size, true); // compressed size
  cdhView.setUint32(24, size, true); // uncompressed size
  cdhView.setUint16(28, nameBytes.length, true); // file name length
  cdhView.setUint16(30, 0, true); // extra field length
  cdhView.setUint16(32, 0, true); // file comment length
  cdhView.setUint16(34, 0, true); // disk number start
  cdhView.setUint16(36, 0, true); // internal file attributes
  cdhView.setUint32(38, 0, true); // external file attributes
  cdhView.setUint32(42, 0, true); // relative offset of local header
  cdh.set(nameBytes, 46);

  // End of central directory record (22 bytes)
  const eocdSize = 22;
  const eocd = new Uint8Array(eocdSize);
  const eocdView = new DataView(eocd.buffer);
  const cdOffset = lfhSize + size; // offset of start of central directory
  eocdView.setUint32(0, 0x06054b50, true); // end of central dir signature
  eocdView.setUint16(4, 0, true); // number of this disk
  eocdView.setUint16(6, 0, true); // disk where central directory starts
  eocdView.setUint16(8, 1, true); // number of central directory records on this disk
  eocdView.setUint16(10, 1, true); // total number of central directory records
  eocdView.setUint32(12, cdhSize, true); // size of central directory
  eocdView.setUint32(16, cdOffset, true); // offset of start of central directory
  eocdView.setUint16(20, 0, true); // comment length

  // Concatenate: LFH + data + CDH + EOCD
  const totalSize = lfhSize + size + cdhSize + eocdSize;
  const zip = new Uint8Array(totalSize);
  let offset = 0;
  zip.set(lfh, offset);
  offset += lfhSize;
  zip.set(data, offset);
  offset += size;
  zip.set(cdh, offset);
  offset += cdhSize;
  zip.set(eocd, offset);

  return zip;
}

// CRC-32 lookup table (IEEE 802.3)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
