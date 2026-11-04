import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parseXlsxWorkbook } from "../src/workbook.js";

const headers = ["company_name", "phone", "email"];

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(
  entries: readonly {
    name: string;
    value: string | Buffer;
    flags?: number;
    uncompressedSizeOverride?: number;
  }[],
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.isBuffer(entry.value)
      ? entry.value
      : Buffer.from(entry.value, "utf8");
    const compressed = deflateRawSync(content);
    const checksum = crc32(content);
    const flags = entry.flags ?? 0x0800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.uncompressedSizeOverride ?? content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function cell(column: number, row: number, value: string): string {
  const col = String.fromCharCode(64 + column);
  return `<c r="${col}${row}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

function workbook(
  rows: readonly (readonly string[])[],
  options: { formula?: boolean; nestedXmlDepth?: number } = {},
): Buffer {
  const sheetRows = rows
    .map((row, index) => {
      const number = index + 1;
      const cells = row
        .map((value, column) => cell(column + 1, number, value))
        .join("");
      const formula =
        options.formula && number === 2
          ? '<c r="D2"><f>1+1</f><v>2</v></c>'
          : "";
      return `<row r="${number}">${cells}${formula}</row>`;
    })
    .join("");
  const nestedXml =
    `<x>`.repeat(options.nestedXmlDepth ?? 0) +
    `</x>`.repeat(options.nestedXmlDepth ?? 0);
  return makeZip([
    {
      name: "[Content_Types].xml",
      value:
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    },
    {
      name: "xl/workbook.xml",
      value:
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Leads" sheetId="1" r:id="rId1" state="visible"/></sheets></workbook>',
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      value:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    {
      name: "xl/worksheets/sheet1.xml",
      value: `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData>${nestedXml}</worksheet>`,
    },
  ]);
}

describe("P0.3d safe XLSX parsing", () => {
  it("parses the approved template without using real lead data", async () => {
    const template = await readFile(
      new URL("../templates/lead-import-template.xlsx", import.meta.url),
    );
    const result = parseXlsxWorkbook("template.xlsx", template);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.sheetName).toBe("Leads");
      expect(result.headers).toContain("company_name");
      expect(result.rows).toHaveLength(0);
    }
  });

  it("reads inline text rows from a valid workbook", () => {
    const bytes = workbook([
      headers,
      ["Công ty tổng hợp", "0901234567", "demo@example.test"],
    ]);
    const result = parseXlsxWorkbook("leads.xlsx", bytes);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.headers).toEqual(headers);
      expect(result.rows).toEqual([
        {
          rowNumber: 2,
          values: ["Công ty tổng hợp", "0901234567", "demo@example.test"],
        },
      ]);
    }
  });

  it.each([
    ["empty bytes", Buffer.alloc(0)],
    ["corrupt bytes", Buffer.from("not a workbook")],
  ])("rejects %s with a safe code", (_name, bytes) => {
    const result = parseXlsxWorkbook("leads.xlsx", bytes);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toMatch(/EMPTY|INVALID/u);
  });

  it("rejects extension/signature mismatches and legacy spreadsheet formats", () => {
    const valid = workbook([headers]);
    expect(parseXlsxWorkbook("leads.xlsm", valid).success).toBe(false);
    expect(parseXlsxWorkbook("leads.xls", valid).success).toBe(false);
    expect(
      parseXlsxWorkbook("leads.xlsx", Buffer.from("D0CF11E0A1B11AE1", "hex"))
        .success,
    ).toBe(false);
  });

  it("rejects formulas without evaluating cached values", () => {
    const result = parseXlsxWorkbook(
      "leads.xlsx",
      workbook([headers, ["Synthetic Co", "", ""]], { formula: true }),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe("FORMULAS_UNSUPPORTED");
  });

  it("rejects macro packages even when renamed to .xlsx", () => {
    const base = workbook([headers]);
    const macro = makeZip([
      {
        name: "[Content_Types].xml",
        value:
          '<Types><Override ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>',
      },
      { name: "xl/vbaProject.bin", value: Buffer.from("synthetic macro") },
    ]);
    expect(parseXlsxWorkbook("renamed.xlsx", macro).success).toBe(false);
    expect(base.length).toBeGreaterThan(0);
  });

  it("rejects external relationships and encrypted ZIP entries", () => {
    const external = makeZip([
      { name: "[Content_Types].xml", value: "<Types/>" },
      {
        name: "xl/_rels/workbook.xml.rels",
        value:
          '<Relationships><Relationship TargetMode="External" Target="https://example.test"/></Relationships>',
      },
    ]);
    expect(parseXlsxWorkbook("external.xlsx", external).success).toBe(false);
    const encrypted = makeZip([
      { name: "[Content_Types].xml", value: "<Types/>", flags: 0x0801 },
    ]);
    expect(parseXlsxWorkbook("encrypted.xlsx", encrypted).success).toBe(false);
  });

  it("enforces compressed-size, row, and column limits", () => {
    const valid = workbook([headers]);
    const oneDataRow = workbook([headers, ["One", "", ""]]);
    expect(
      parseXlsxWorkbook("at-size-boundary.xlsx", oneDataRow, {
        maxFileBytes: oneDataRow.length,
      }).success,
    ).toBe(true);
    expect(
      parseXlsxWorkbook("at-row-boundary.xlsx", oneDataRow, { maxRows: 2 })
        .success,
    ).toBe(true);
    expect(
      parseXlsxWorkbook("at-column-boundary.xlsx", valid, { maxColumns: 3 })
        .success,
    ).toBe(true);
    expect(
      parseXlsxWorkbook("large.xlsx", Buffer.alloc(101), {
        maxFileBytes: 100,
      }).success,
    ).toBe(false);
    const tooManyRows = workbook([headers, ["One", "", ""], ["Two", "", ""]]);
    expect(
      parseXlsxWorkbook("rows.xlsx", tooManyRows, { maxRows: 2 }).success,
    ).toBe(false);
    const tooManyColumns = workbook([["company_name", "phone", "extra"]]);
    expect(
      parseXlsxWorkbook("columns.xlsx", tooManyColumns, { maxColumns: 2 })
        .success,
    ).toBe(false);
    const bomb = makeZip([
      { name: "[Content_Types].xml", value: "A".repeat(20000) },
    ]);
    expect(
      parseXlsxWorkbook("bomb.xlsx", bomb, { maxCompressionRatio: 10 }).success,
    ).toBe(false);
    expect(valid.length).toBeGreaterThan(0);
  });

  it("enforces the configured XML nesting-depth boundary", () => {
    const deepWorkbook = workbook([headers], { nestedXmlDepth: 10 });
    expect(
      parseXlsxWorkbook("depth-boundary.xlsx", deepWorkbook, {
        maxXmlDepth: 11,
      }).success,
    ).toBe(true);
    expect(
      parseXlsxWorkbook("too-deep.xlsx", deepWorkbook, { maxXmlDepth: 10 })
        .success,
    ).toBe(false);
  });
});
