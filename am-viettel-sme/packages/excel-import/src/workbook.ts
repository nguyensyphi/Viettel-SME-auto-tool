import { Buffer } from "node:buffer";
import { inflateRawSync } from "node:zlib";
import { SaxesParser } from "saxes";

export interface XlsxParserLimits {
  /** Maximum uploaded archive size. */
  readonly maxFileBytes: number;
  /** Maximum number of ZIP central-directory entries. */
  readonly maxZipEntries: number;
  /** Maximum total uncompressed size across all ZIP entries. */
  readonly maxTotalUncompressedBytes: number;
  /** Maximum uncompressed size of any single ZIP entry. */
  readonly maxEntryUncompressedBytes: number;
  /** Maximum per-entry uncompressed/compressed size ratio. */
  readonly maxCompressionRatio: number;
  /** Maximum worksheet row index, including the header row. */
  readonly maxRows: number;
  /** Maximum worksheet column index. */
  readonly maxColumns: number;
  /** Maximum XML nodes in any one part. */
  readonly maxXmlNodes: number;
  /** Maximum nested XML element depth in any one part. */
  readonly maxXmlDepth: number;
}

export const DEFAULT_XLSX_PARSER_LIMITS: XlsxParserLimits = {
  maxFileBytes: 5 * 1024 * 1024,
  maxZipEntries: 256,
  maxTotalUncompressedBytes: 16 * 1024 * 1024,
  maxEntryUncompressedBytes: 8 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxRows: 10_001,
  maxColumns: 64,
  maxXmlNodes: 250_000,
  maxXmlDepth: 128,
};

export interface ParsedWorkbookRow {
  readonly rowNumber: number;
  readonly values: readonly unknown[];
}

export interface ParsedXlsxWorkbook {
  readonly success: true;
  readonly sheetName: "Leads";
  readonly headers: readonly unknown[];
  readonly rows: readonly ParsedWorkbookRow[];
}

export interface XlsxParseFailure {
  readonly success: false;
  readonly errorCode: XlsxParseErrorCode;
}

export type XlsxParseErrorCode =
  | "FILE_EXTENSION_NOT_ALLOWED"
  | "FILE_TOO_LARGE"
  | "EMPTY_FILE"
  | "INVALID_XLSX_SIGNATURE"
  | "INVALID_ZIP"
  | "ENCRYPTED_WORKBOOK_UNSUPPORTED"
  | "ZIP_ENTRY_LIMIT_EXCEEDED"
  | "ZIP_EXPANSION_LIMIT_EXCEEDED"
  | "UNSUPPORTED_COMPRESSION_METHOD"
  | "MACRO_WORKBOOK_UNSUPPORTED"
  | "EXTERNAL_LINKS_UNSUPPORTED"
  | "WORKBOOK_XML_INVALID"
  | "WORKSHEET_XML_INVALID"
  | "SHARED_STRINGS_INVALID"
  | "WORKSHEET_NOT_FOUND"
  | "WORKSHEET_LIMIT_EXCEEDED"
  | "FORMULAS_UNSUPPORTED";

export type XlsxParseResult = ParsedXlsxWorkbook | XlsxParseFailure;

interface ZipEntry {
  readonly name: string;
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
}

interface XmlNode {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: XmlNode[];
  text: string;
}

class SafeParseError extends Error {
  constructor(readonly code: XlsxParseErrorCode) {
    super(code);
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new SafeParseError("INVALID_ZIP");
  return result;
}

function readZipDirectory(
  bytes: Buffer,
  limits: XlsxParserLimits,
): { readonly entries: Map<string, ZipEntry>; readonly centralOffset: number } {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new SafeParseError("INVALID_XLSX_SIGNATURE");
  }

  const minSearchOffset = Math.max(0, bytes.length - 65_557);
  let eocdOffset = -1;
  for (let cursor = bytes.length - 22; cursor >= minSearchOffset; cursor -= 1) {
    if (bytes.readUInt32LE(cursor) === 0x06054b50) {
      const commentLength = bytes.readUInt16LE(cursor + 20);
      if (cursor + 22 + commentLength === bytes.length) {
        eocdOffset = cursor;
        break;
      }
    }
  }
  if (eocdOffset < 0) throw new SafeParseError("INVALID_ZIP");

  const diskNumber = bytes.readUInt16LE(eocdOffset + 4);
  const centralDisk = bytes.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocdOffset + 8);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralSize = bytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new SafeParseError("INVALID_ZIP");
  }
  if (entryCount > limits.maxZipEntries) {
    throw new SafeParseError("ZIP_ENTRY_LIMIT_EXCEEDED");
  }
  if (
    safeAdd(centralOffset, centralSize) !== eocdOffset ||
    centralOffset > bytes.length
  ) {
    throw new SafeParseError("INVALID_ZIP");
  }

  const entries = new Map<string, ZipEntry>();
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > eocdOffset || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw new SafeParseError("INVALID_ZIP");
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const diskStart = bytes.readUInt16LE(cursor + 34);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const recordEnd = safeAdd(
      cursor + 46,
      nameLength + extraLength + commentLength,
    );
    if (
      recordEnd > eocdOffset ||
      diskStart !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new SafeParseError("INVALID_ZIP");
    }

    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) {
      throw new SafeParseError("ENCRYPTED_WORKBOOK_UNSUPPORTED");
    }
    if (method !== 0 && method !== 8) {
      throw new SafeParseError("UNSUPPORTED_COMPRESSION_METHOD");
    }

    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    let name: string;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    } catch {
      throw new SafeParseError("INVALID_ZIP");
    }
    if (
      name === "" ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.includes(":") ||
      name.split("/").some((part) => part === "..")
    ) {
      throw new SafeParseError("INVALID_ZIP");
    }
    if (entries.has(name)) throw new SafeParseError("INVALID_ZIP");

    if (
      uncompressedSize > limits.maxEntryUncompressedBytes ||
      safeAdd(totalUncompressed, uncompressedSize) >
        limits.maxTotalUncompressedBytes
    ) {
      throw new SafeParseError("ZIP_EXPANSION_LIMIT_EXCEEDED");
    }
    totalUncompressed += uncompressedSize;
    if (
      uncompressedSize > 0 &&
      (compressedSize === 0 ||
        uncompressedSize / compressedSize > limits.maxCompressionRatio)
    ) {
      throw new SafeParseError("ZIP_EXPANSION_LIMIT_EXCEEDED");
    }

    entries.set(name, {
      name,
      flags,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor = recordEnd;
  }
  if (cursor !== eocdOffset) throw new SafeParseError("INVALID_ZIP");
  return { entries, centralOffset };
}

function extractZipEntry(
  bytes: Buffer,
  entry: ZipEntry,
  limits: XlsxParserLimits,
  centralOffset: number,
): Buffer {
  const offset = entry.localOffset;
  if (
    offset + 30 > centralOffset ||
    bytes.readUInt32LE(offset) !== 0x04034b50
  ) {
    throw new SafeParseError("INVALID_ZIP");
  }
  const flags = bytes.readUInt16LE(offset + 6);
  const method = bytes.readUInt16LE(offset + 8);
  const nameLength = bytes.readUInt16LE(offset + 26);
  const extraLength = bytes.readUInt16LE(offset + 28);
  if (flags !== entry.flags || method !== entry.method) {
    throw new SafeParseError("INVALID_ZIP");
  }
  const nameStart = offset + 30;
  const dataStart = safeAdd(nameStart, nameLength + extraLength);
  const dataEnd = safeAdd(dataStart, entry.compressedSize);
  if (dataEnd > centralOffset) throw new SafeParseError("INVALID_ZIP");
  const localName = new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(nameStart, nameStart + nameLength),
  );
  if (localName !== entry.name) throw new SafeParseError("INVALID_ZIP");

  const compressed = bytes.subarray(dataStart, dataEnd);
  let content: Buffer;
  try {
    if (entry.method === 0) {
      content = Buffer.from(compressed);
    } else {
      content = inflateRawSync(compressed, {
        maxOutputLength: Math.max(1, entry.uncompressedSize + 1),
      });
    }
  } catch {
    throw new SafeParseError("INVALID_ZIP");
  }
  if (
    content.length !== entry.uncompressedSize ||
    content.length > limits.maxEntryUncompressedBytes ||
    crc32(content) !== entry.crc
  ) {
    throw new SafeParseError("INVALID_ZIP");
  }
  return content;
}

function readTextPart(
  parts: ReadonlyMap<string, Buffer>,
  name: string,
): string {
  const bytes = parts.get(name);
  if (!bytes) throw new SafeParseError("WORKBOOK_XML_INVALID");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SafeParseError("WORKBOOK_XML_INVALID");
  }
}

function parseXml(xml: string, maxNodes: number, maxDepth: number): XmlNode {
  const root: XmlNode = {
    name: "#document",
    attributes: {},
    children: [],
    text: "",
  };
  const stack: XmlNode[] = [root];
  let nodeCount = 0;
  let invalid = false;
  const parser = new SaxesParser({ position: false });
  parser.on("error", () => {
    invalid = true;
  });
  parser.on("doctype", () => {
    invalid = true;
  });
  parser.on("opentag", (tag) => {
    nodeCount += 1;
    if (nodeCount > maxNodes || stack.length > maxDepth) {
      invalid = true;
      return;
    }
    const parent = stack.at(-1);
    if (!parent) {
      invalid = true;
      return;
    }
    const attributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(tag.attributes)) {
      if (typeof value !== "string") {
        invalid = true;
        continue;
      }
      attributes[key] = value;
    }
    const child: XmlNode = {
      name: tag.name.split(":").at(-1) ?? tag.name,
      attributes,
      children: [],
      text: "",
    };
    parent.children.push(child);
    stack.push(child);
  });
  parser.on("text", (text) => {
    const current = stack.at(-1);
    if (current) current.text += text;
  });
  parser.on("cdata", (text) => {
    const current = stack.at(-1);
    if (current) current.text += text;
  });
  parser.on("closetag", () => {
    if (stack.length <= 1) {
      invalid = true;
      return;
    }
    stack.pop();
  });
  try {
    parser.write(xml).close();
  } catch {
    invalid = true;
  }
  if (invalid || stack.length !== 1 || root.children.length !== 1) {
    throw new SafeParseError("WORKBOOK_XML_INVALID");
  }
  return root.children[0]!;
}

function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((item) => item.name === name);
}

function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((item) => item.name === name);
}

function descendantsText(node: XmlNode, name: string): string {
  return node.children
    .flatMap((item) =>
      item.name === name ? [item.text] : [descendantsText(item, name)],
    )
    .join("");
}

function getPart(parts: ReadonlyMap<string, Buffer>, name: string): Buffer {
  const result = parts.get(name);
  if (!result) throw new SafeParseError("WORKBOOK_XML_INVALID");
  return result;
}

function normalizePartPath(sourcePart: string, target: string): string {
  if (target.includes("\\") || target.includes("#") || target.includes("?")) {
    throw new SafeParseError("WORKBOOK_XML_INVALID");
  }
  const stack = target.startsWith("/")
    ? []
    : sourcePart.split("/").slice(0, -1);
  const targetParts = (target.startsWith("/") ? target.slice(1) : target).split(
    "/",
  );
  for (const part of targetParts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) throw new SafeParseError("WORKBOOK_XML_INVALID");
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  const normalized = stack.join("/");
  if (
    !normalized.startsWith("xl/worksheets/") &&
    !normalized.startsWith("xl/")
  ) {
    throw new SafeParseError("WORKBOOK_XML_INVALID");
  }
  return normalized;
}

function columnNumber(reference: string): number {
  let result = 0;
  for (const char of reference) {
    result = result * 26 + char.charCodeAt(0) - 64;
  }
  return result;
}

function parseCellReference(
  reference: string,
  maxRows: number,
  maxColumns: number,
): { row: number; column: number } {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/u.exec(reference);
  if (!match) throw new SafeParseError("WORKSHEET_LIMIT_EXCEEDED");
  const column = columnNumber(match[1]!);
  const row = Number(match[2]);
  if (
    !Number.isSafeInteger(row) ||
    row > maxRows ||
    column < 1 ||
    column > maxColumns
  ) {
    throw new SafeParseError("WORKSHEET_LIMIT_EXCEEDED");
  }
  return { row, column };
}

function validateDimension(worksheet: XmlNode, limits: XlsxParserLimits): void {
  const reference = child(worksheet, "dimension")?.attributes.ref;
  if (!reference) return;
  const endpoints = reference.split(":");
  if (endpoints.length > 2) {
    throw new SafeParseError("WORKSHEET_LIMIT_EXCEEDED");
  }
  for (const endpoint of endpoints) {
    parseCellReference(endpoint!, limits.maxRows, limits.maxColumns);
  }
}

function getCellValue(
  cellNode: XmlNode,
  sharedStrings: readonly string[],
): unknown {
  if (child(cellNode, "f")) throw new SafeParseError("FORMULAS_UNSUPPORTED");
  const type = cellNode.attributes.t ?? "n";
  const valueNode = child(cellNode, "v");
  if (type === "inlineStr")
    return descendantsText(child(cellNode, "is") ?? cellNode, "t");
  if (type === "s") {
    const index = Number(valueNode?.text);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= sharedStrings.length
    ) {
      throw new SafeParseError("WORKSHEET_XML_INVALID");
    }
    return sharedStrings[index];
  }
  if (type === "str") return valueNode?.text ?? "";
  if (type === "d") return valueNode?.text ?? "";
  if (type === "b") return valueNode?.text === "1";
  if (type === "e") return { type: "ERROR_CELL" };
  if (type === "n") {
    if (!valueNode || valueNode.text.trim() === "") return null;
    const number = Number(valueNode.text);
    return Number.isFinite(number) ? number : { type: "INVALID_NUMBER_CELL" };
  }
  if (type === "" && valueNode) return valueNode.text;
  return { type: "UNSUPPORTED_CELL_TYPE" };
}

function parseSharedStrings(
  parts: ReadonlyMap<string, Buffer>,
  limits: XlsxParserLimits,
): readonly string[] {
  const bytes = parts.get("xl/sharedStrings.xml");
  if (!bytes) return [];
  try {
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const root = parseXml(xml, limits.maxXmlNodes, limits.maxXmlDepth);
    if (root.name !== "sst") throw new SafeParseError("SHARED_STRINGS_INVALID");
    return children(root, "si").map((item) => descendantsText(item, "t"));
  } catch {
    throw new SafeParseError("SHARED_STRINGS_INVALID");
  }
}

function inspectRelationshipParts(
  parts: ReadonlyMap<string, Buffer>,
  limits: XlsxParserLimits,
): void {
  for (const [name, bytes] of parts) {
    if (!name.endsWith(".rels")) continue;
    let root: XmlNode;
    try {
      root = parseXml(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        limits.maxXmlNodes,
        limits.maxXmlDepth,
      );
    } catch {
      throw new SafeParseError("WORKBOOK_XML_INVALID");
    }
    if (root.name !== "Relationships") {
      throw new SafeParseError("WORKBOOK_XML_INVALID");
    }
    if (
      children(root, "Relationship").some(
        (relationship) =>
          (relationship.attributes.TargetMode ?? "").toLowerCase() ===
          "external",
      )
    ) {
      throw new SafeParseError("EXTERNAL_LINKS_UNSUPPORTED");
    }
  }
}

function parseWorksheet(
  xmlBytes: Buffer,
  sharedStrings: readonly string[],
  limits: XlsxParserLimits,
): {
  readonly rows: readonly ParsedWorkbookRow[];
  readonly hasFormula: boolean;
} {
  let root: XmlNode;
  try {
    root = parseXml(
      new TextDecoder("utf-8", { fatal: true }).decode(xmlBytes),
      limits.maxXmlNodes,
      limits.maxXmlDepth,
    );
  } catch {
    throw new SafeParseError("WORKSHEET_XML_INVALID");
  }
  if (root.name !== "worksheet") {
    throw new SafeParseError("WORKSHEET_XML_INVALID");
  }
  validateDimension(root, limits);
  const sheetData = child(root, "sheetData");
  if (!sheetData) throw new SafeParseError("WORKSHEET_XML_INVALID");

  const rows: ParsedWorkbookRow[] = [];
  const seenRowNumbers = new Set<number>();
  let hasFormula = false;
  for (const rowNode of children(sheetData, "row")) {
    const rowNumber = Number(rowNode.attributes.r);
    if (
      !Number.isSafeInteger(rowNumber) ||
      rowNumber < 1 ||
      rowNumber > limits.maxRows ||
      seenRowNumbers.has(rowNumber)
    ) {
      throw new SafeParseError("WORKSHEET_LIMIT_EXCEEDED");
    }
    seenRowNumbers.add(rowNumber);
    const values: unknown[] = [];
    const seenColumns = new Set<number>();
    for (const cellNode of children(rowNode, "c")) {
      const reference = cellNode.attributes.r;
      if (!reference) throw new SafeParseError("WORKSHEET_XML_INVALID");
      const location = parseCellReference(
        reference,
        limits.maxRows,
        limits.maxColumns,
      );
      if (location.row !== rowNumber || seenColumns.has(location.column)) {
        throw new SafeParseError("WORKSHEET_XML_INVALID");
      }
      seenColumns.add(location.column);
      if (child(cellNode, "f")) hasFormula = true;
      values[location.column - 1] = getCellValue(cellNode, sharedStrings);
    }
    rows.push({ rowNumber, values });
  }
  return { rows, hasFormula };
}

function normalizedLimits(
  overrides: Partial<XlsxParserLimits>,
): XlsxParserLimits {
  const limits = { ...DEFAULT_XLSX_PARSER_LIMITS, ...overrides };
  if (
    Object.values(limits).some(
      (value) => !Number.isSafeInteger(value) || value < 1,
    )
  ) {
    throw new SafeParseError("INVALID_ZIP");
  }
  return limits;
}

function parseWorkbookParts(
  parts: ReadonlyMap<string, Buffer>,
  limits: XlsxParserLimits,
): ParsedXlsxWorkbook {
  if (
    [...parts.keys()].some((name) =>
      /(?:^|\/)vbaproject(?:signature)?\.bin$/iu.test(name),
    )
  ) {
    throw new SafeParseError("MACRO_WORKBOOK_UNSUPPORTED");
  }
  for (const name of parts.keys()) {
    if (/^xl\/externallinks\//iu.test(name)) {
      throw new SafeParseError("EXTERNAL_LINKS_UNSUPPORTED");
    }
  }

  const contentTypes = parseXml(
    readTextPart(parts, "[Content_Types].xml"),
    limits.maxXmlNodes,
    limits.maxXmlDepth,
  );
  if (contentTypes.name !== "Types") {
    throw new SafeParseError("WORKBOOK_XML_INVALID");
  }
  const contentTypesText = JSON.stringify(contentTypes).toLowerCase();
  if (
    contentTypesText.includes("macroenabled") ||
    contentTypesText.includes("vbaproject")
  ) {
    throw new SafeParseError("MACRO_WORKBOOK_UNSUPPORTED");
  }
  inspectRelationshipParts(parts, limits);

  const workbook = parseXml(
    readTextPart(parts, "xl/workbook.xml"),
    limits.maxXmlNodes,
    limits.maxXmlDepth,
  );
  if (workbook.name !== "workbook")
    throw new SafeParseError("WORKBOOK_XML_INVALID");
  const relationships = parseXml(
    readTextPart(parts, "xl/_rels/workbook.xml.rels"),
    limits.maxXmlNodes,
    limits.maxXmlDepth,
  );
  if (relationships.name !== "Relationships") {
    throw new SafeParseError("WORKBOOK_XML_INVALID");
  }
  const relationTargets = new Map<string, string>();
  const relationshipIds = new Set<string>();
  for (const relationship of children(relationships, "Relationship")) {
    const id = relationship.attributes.Id;
    const target = relationship.attributes.Target;
    const type = relationship.attributes.Type ?? "";
    if (!id || !target || relationshipIds.has(id)) {
      throw new SafeParseError("WORKBOOK_XML_INVALID");
    }
    relationshipIds.add(id);
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(target)) {
      throw new SafeParseError("EXTERNAL_LINKS_UNSUPPORTED");
    }
    if (type.endsWith("/worksheet")) {
      const path = normalizePartPath("xl/workbook.xml", target);
      if ([...relationTargets.values()].includes(path)) {
        throw new SafeParseError("WORKBOOK_XML_INVALID");
      }
      relationTargets.set(id, path);
    }
  }

  const sheets = children(child(workbook, "sheets") ?? workbook, "sheet");
  const leadSheets = sheets.filter(
    (sheet) => sheet.attributes.name === "Leads",
  );
  if (leadSheets.length !== 1) throw new SafeParseError("WORKSHEET_NOT_FOUND");
  const leadSheet = leadSheets[0]!;
  if (
    leadSheet.attributes.state === "hidden" ||
    leadSheet.attributes.state === "veryHidden"
  ) {
    throw new SafeParseError("WORKSHEET_NOT_FOUND");
  }
  const leadTarget = leadSheet.attributes["r:id"];
  if (!leadTarget) throw new SafeParseError("WORKBOOK_XML_INVALID");
  const leadPath = relationTargets.get(leadTarget);
  if (!leadPath) throw new SafeParseError("WORKBOOK_XML_INVALID");

  const sharedStrings = parseSharedStrings(parts, limits);
  const linkedWorksheetPaths = new Set(relationTargets.values());
  for (const name of parts.keys()) {
    if (
      /^xl\/worksheets\/[^/]+\.xml$/iu.test(name) &&
      !linkedWorksheetPaths.has(name)
    ) {
      throw new SafeParseError("WORKBOOK_XML_INVALID");
    }
  }
  let selectedWorksheet: ReturnType<typeof parseWorksheet> | undefined;
  for (const [id, path] of relationTargets) {
    const parsed = parseWorksheet(getPart(parts, path), sharedStrings, limits);
    if (parsed.hasFormula) throw new SafeParseError("FORMULAS_UNSUPPORTED");
    if (id === leadTarget) selectedWorksheet = parsed;
  }
  if (!selectedWorksheet) throw new SafeParseError("WORKSHEET_NOT_FOUND");

  const headerRow = selectedWorksheet.rows.find((row) => row.rowNumber === 1);
  if (!headerRow) throw new SafeParseError("WORKSHEET_NOT_FOUND");
  const headers = [...headerRow.values];
  const rows = selectedWorksheet.rows
    .filter((row) => row.rowNumber > 1)
    .filter((row) =>
      row.values.some(
        (value) => value !== null && value !== undefined && value !== "",
      ),
    )
    .map((row) => ({ rowNumber: row.rowNumber, values: [...row.values] }));
  return { success: true, sheetName: "Leads", headers, rows };
}

/**
 * Parse only approved XLSX workbooks from an in-memory byte buffer. The parser
 * does not evaluate formulas, follow external relationships, or write workbook
 * data to disk. All failures are returned as safe, field-free codes.
 */
export function parseXlsxWorkbook(
  filename: string,
  input: Uint8Array,
  overrides: Partial<XlsxParserLimits> = {},
): XlsxParseResult {
  try {
    const limits = normalizedLimits(overrides);
    if (!/\.xlsx$/iu.test(filename)) {
      throw new SafeParseError("FILE_EXTENSION_NOT_ALLOWED");
    }
    if (input.byteLength === 0) throw new SafeParseError("EMPTY_FILE");
    if (input.byteLength > limits.maxFileBytes) {
      throw new SafeParseError("FILE_TOO_LARGE");
    }
    const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    const directory = readZipDirectory(bytes, limits);
    const parts = new Map<string, Buffer>();
    for (const entry of directory.entries.values()) {
      if (entry.name.endsWith("/")) continue;
      parts.set(
        entry.name,
        extractZipEntry(bytes, entry, limits, directory.centralOffset),
      );
    }
    const parsed = parseWorkbookParts(parts, limits);
    return parsed;
  } catch (error) {
    if (error instanceof SafeParseError) {
      return { success: false, errorCode: error.code };
    }
    return { success: false, errorCode: "INVALID_ZIP" };
  }
}
