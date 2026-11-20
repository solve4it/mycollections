import { type FieldDefinition, FieldDefinitionSchema, ITEM_IMPORT_MAX_ROWS } from "@mycollections/core";
import { describe, expect, it } from "vitest";
import {
  type ColumnTarget,
  CSV_MAX_BYTES,
  CSV_MAX_COLUMNS,
  convertRows,
  fieldsCsvCannotFill,
  mappingProblems,
  readCsv,
  suggestMapping,
} from "./csv-import.js";

const csv = (text: string | Uint8Array<ArrayBuffer>, name = "items.csv") =>
  new File([text], name, { type: "text/csv" });

const fields: FieldDefinition[] = [
  { id: "f-title", type: "text", label: "Title", required: true },
  { id: "f-year", type: "number", label: "Year", required: false },
  FieldDefinitionSchema.parse({ id: "f-cond", type: "select", label: "Condition", options: ["Mint", "Good"] }),
  { id: "f-cover", type: "image", label: "Cover", required: false },
];

const labels = { owned: "Owned", wanted: "Wanted", ordered: "On its way" };

describe("readCsv (#44)", () => {
  it("reads a header row and the rows under it, quotes and all", async () => {
    const result = await readCsv(csv('Title,Notes\nDune,"a ""classic"", long"\nEmma,"two\nlines"\n'));
    expect(result).toEqual({
      ok: true,
      table: {
        headers: ["Title", "Notes"],
        rows: [
          ["Dune", 'a "classic", long'],
          ["Emma", "two\nlines"],
        ],
      },
    });
  });

  it("drops a byte order mark, blank lines and spaces around headers", async () => {
    const result = await readCsv(csv("﻿ Title ,Year\n\nDune,1965\n  \n"));
    expect(result).toEqual({ ok: true, table: { headers: ["Title", "Year"], rows: [["Dune", "1965"]] } });
  });

  it("finds a semicolon delimiter on its own, as European spreadsheets write", async () => {
    const result = await readCsv(csv("Title;Price\nDune;1,50\n"));
    expect(result).toEqual({ ok: true, table: { headers: ["Title", "Price"], rows: [["Dune", "1,50"]] } });
  });

  it("pads short rows and keeps cells as text, never as numbers", async () => {
    const result = await readCsv(csv("Code,Name,Extra\n007\n"));
    expect(result).toEqual({ ok: true, table: { headers: ["Code", "Name", "Extra"], rows: [["007", "", ""]] } });
  });

  it("keeps a row's cells past the header, so the row can be refused rather than cut short", async () => {
    const result = await readCsv(csv("Title,Year\nFoo, Jr.,2020\n"));
    expect(result).toEqual({ ok: true, table: { headers: ["Title", "Year"], rows: [["Foo", " Jr.", "2020"]] } });
  });

  it("refuses what it cannot read, saying why in a fixed word", async () => {
    expect(await readCsv(csv("Title\n"))).toEqual({ ok: false, reason: "empty" });
    expect(await readCsv(csv(""))).toEqual({ ok: false, reason: "empty" });
    expect(await readCsv(csv('Title\n"Dune\n'))).toEqual({ ok: false, reason: "unreadable" });
    expect(await readCsv(csv(new Uint8Array([0xff, 0xfe, 0x54, 0x00])))).toEqual({ ok: false, reason: "encoding" });
    expect(await readCsv(csv(new Uint8Array([0xfe, 0xff, 0x00, 0x54])))).toEqual({ ok: false, reason: "encoding" });
  });

  it("refuses a file, a row count or a column count past the caps", async () => {
    expect(await readCsv(csv("a".repeat(CSV_MAX_BYTES + 1)))).toEqual({ ok: false, reason: "too-large" });
    const rows = `Title\n${"x\n".repeat(ITEM_IMPORT_MAX_ROWS + 1)}`;
    expect(await readCsv(csv(rows))).toEqual({ ok: false, reason: "too-many-rows" });
    const wide = `${Array.from({ length: CSV_MAX_COLUMNS + 1 }, (_, i) => `c${i}`).join(",")}\n1\n`;
    expect(await readCsv(csv(wide))).toEqual({ ok: false, reason: "too-many-columns" });
  });

  it("takes exactly the row cap", async () => {
    const result = await readCsv(csv(`Title\n${"x\n".repeat(ITEM_IMPORT_MAX_ROWS)}`));
    expect(result.ok && result.table.rows.length).toBe(ITEM_IMPORT_MAX_ROWS);
  });
});

describe("suggestMapping", () => {
  it("matches headers to field labels or ids, and a status column, ignoring case", () => {
    expect(suggestMapping([" title ", "F-YEAR", "Status", "Shelf"], fields, ["Status"])).toEqual([
      { kind: "field", fieldId: "f-title" },
      { kind: "field", fieldId: "f-year" },
      { kind: "status" },
      { kind: "skip" },
    ]);
  });

  it("gives each field to the first matching column only, and never suggests an image field", () => {
    expect(suggestMapping(["Title", "title", "Cover"], fields, ["Status"])).toEqual([
      { kind: "field", fieldId: "f-title" },
      { kind: "skip" },
      { kind: "skip" },
    ]);
  });
});

describe("fieldsCsvCannotFill", () => {
  it("names the required image fields, which no CSV column can fill", () => {
    const required = { id: "f-photo", type: "image" as const, label: "Photo", required: true };
    expect(fieldsCsvCannotFill([...fields, required])).toEqual(["f-photo"]);
    expect(fieldsCsvCannotFill(fields)).toEqual([]);
  });
});

describe("mappingProblems", () => {
  it("names required fields no column fills and targets chosen twice", () => {
    const mapping: ColumnTarget[] = [
      { kind: "field", fieldId: "f-year" },
      { kind: "field", fieldId: "f-year" },
      { kind: "status" },
      { kind: "status" },
    ];
    expect(mappingProblems(mapping, fields)).toEqual({ missingRequired: ["f-title"], duplicateColumns: [1, 3] });
  });

  it("leaves a required image field to fieldsCsvCannotFill, since no column can be chosen for it", () => {
    const withPhoto = [...fields, { id: "f-photo", type: "image" as const, label: "Photo", required: true }];
    expect(mappingProblems([{ kind: "field", fieldId: "f-title" }], withPhoto).missingRequired).toEqual([]);
  });

  it("finds nothing wrong with a mapping that fills every required field once", () => {
    expect(
      mappingProblems([{ kind: "field", fieldId: "f-title" }, { kind: "skip" }, { kind: "skip" }], fields),
    ).toEqual({
      missingRequired: [],
      duplicateColumns: [],
    });
  });
});

describe("convertRows", () => {
  const mapping: ColumnTarget[] = [
    { kind: "field", fieldId: "f-title" },
    { kind: "field", fieldId: "f-year" },
    { kind: "field", fieldId: "f-cond" },
    { kind: "status" },
    { kind: "skip" },
  ];
  const table = {
    headers: ["Title", "Year", "Condition", "Status", "Shelf"],
    rows: [
      ["Dune", "1965", "mint", "wanted", "A1"],
      ["", "1816", "Good", "", "A2"],
      ["Emma", "eighteen", "Poor", "sold", "A3"],
      ["Persuasion", "", "", "On its way", "A4"],
    ],
  };

  it("types the rows that convert, and lists every refused cell of the rest", () => {
    const result = convertRows(table, mapping, fields, labels);
    expect(result.rows).toEqual([
      { row: 1, ok: true, item: { status: "wanted", fields: { "f-title": "Dune", "f-year": 1965, "f-cond": "Mint" } } },
      { row: 2, ok: false, issues: [{ column: 0, issue: "required" }] },
      {
        row: 3,
        ok: false,
        issues: [
          { column: 1, issue: "invalid" },
          { column: 2, issue: "invalid" },
          { column: 3, issue: "invalid" },
        ],
      },
      {
        row: 4,
        ok: true,
        item: { status: "ordered", fields: { "f-title": "Persuasion", "f-year": null, "f-cond": "" } },
      },
    ]);
  });

  it("sends only the rows that converted, leaving an empty status to the default", () => {
    const result = convertRows(table, mapping, fields, labels);
    expect(result.items).toEqual([
      { status: "wanted", fields: { "f-title": "Dune", "f-year": 1965, "f-cond": "Mint" } },
      { status: "ordered", fields: { "f-title": "Persuasion", "f-year": null, "f-cond": "" } },
    ]);
    const noStatus = convertRows(
      { headers: ["Title"], rows: [["Dune"]] },
      [{ kind: "field", fieldId: "f-title" }],
      fields,
      labels,
    );
    expect(noStatus.items).toEqual([{ fields: { "f-title": "Dune" } }]);
  });

  it("skips a row with more cells than the header has columns, naming the first extra one", () => {
    const wide = { headers: ["Title"], rows: [["Smith", " Jr."], ["Emma"]] };
    const result = convertRows(wide, [{ kind: "field", fieldId: "f-title" }], fields, labels);
    expect(result.rows).toEqual([
      { row: 1, ok: false, issues: [{ column: 1, issue: "extra-cells" }] },
      { row: 2, ok: true, item: { fields: { "f-title": "Emma" } } },
    ]);
    expect(result.items).toEqual([{ fields: { "f-title": "Emma" } }]);
  });

  it("builds fields on a prototype-free object, so a field id cannot reach Object.prototype", () => {
    const odd: FieldDefinition[] = [{ id: "__proto__", type: "text", label: "Odd", required: false }];
    const result = convertRows(
      { headers: ["Odd"], rows: [["x"]] },
      [{ kind: "field", fieldId: "__proto__" }],
      odd,
      labels,
    );
    expect(JSON.stringify(result.items)).toBe('[{"fields":{"__proto__":"x"}}]');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});
