import { describe, expect, it } from "vite-plus/test";
import type { DimensionMember, Dimensions } from "../domain/types.ts";
import {
  buildAncestorLookup,
  buildDescendantLookup,
  cloneDimensionTreeWithSort,
  compareDimensionMembers,
  dimensionTitle,
  flattenMembers,
  flattenMembersWithDepth,
  isMonth,
  orderedNamesFromMembers,
  orderedOptionsFromMembers,
  updateDimensionSortOrder,
} from "./dimension-utils.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function member(
  name: string,
  children: DimensionMember[] = [],
  parentName: string | null = null,
  sortOrder?: number,
): DimensionMember {
  return { name, parentName, referenceCount: 0, children, sortOrder };
}

const tree: DimensionMember[] = [
  member("Total Company", [
    member("Product", [member("GPU Cloud"), member("New Ventures")], "Total Company"),
    member("Engineering", [], "Total Company"),
  ]),
];

// ---------------------------------------------------------------------------
// flattenMembers
// ---------------------------------------------------------------------------

describe("flattenMembers", () => {
  it("returns depth-first ordered list", () => {
    const result = flattenMembers(tree);
    expect(result.map((m) => m.name)).toEqual([
      "Total Company",
      "Product",
      "GPU Cloud",
      "New Ventures",
      "Engineering",
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(flattenMembers([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// flattenMembersWithDepth
// ---------------------------------------------------------------------------

describe("flattenMembersWithDepth", () => {
  it("assigns correct depths", () => {
    const result = flattenMembersWithDepth(tree);
    expect(result.find((m) => m.name === "Total Company")?.depth).toBe(0);
    expect(result.find((m) => m.name === "Product")?.depth).toBe(1);
    expect(result.find((m) => m.name === "GPU Cloud")?.depth).toBe(2);
    expect(result.find((m) => m.name === "Engineering")?.depth).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildDescendantLookup
// ---------------------------------------------------------------------------

describe("buildDescendantLookup", () => {
  it("includes self in descendant list", () => {
    const lookup = buildDescendantLookup(tree);
    expect(lookup.get("GPU Cloud")).toEqual(["GPU Cloud"]);
  });

  it("includes all nested descendants", () => {
    const lookup = buildDescendantLookup(tree);
    const tc = lookup.get("Total Company") ?? [];
    expect(tc).toContain("Total Company");
    expect(tc).toContain("Product");
    expect(tc).toContain("GPU Cloud");
    expect(tc).toContain("Engineering");
  });

  it("returns empty map for empty input", () => {
    expect(buildDescendantLookup([]).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildAncestorLookup
// ---------------------------------------------------------------------------

describe("buildAncestorLookup", () => {
  it("returns empty ancestors for root members", () => {
    const lookup = buildAncestorLookup(tree);
    expect(lookup.get("Total Company")).toEqual([]);
  });

  it("returns ordered ancestors for a leaf member", () => {
    const lookup = buildAncestorLookup(tree);
    expect(lookup.get("GPU Cloud")).toEqual(["Total Company", "Product"]);
  });

  it("returns single ancestor for depth-1 member", () => {
    const lookup = buildAncestorLookup(tree);
    expect(lookup.get("Engineering")).toEqual(["Total Company"]);
  });
});

// ---------------------------------------------------------------------------
// orderedNamesFromMembers
// ---------------------------------------------------------------------------

describe("orderedNamesFromMembers", () => {
  it("preserves hierarchy order and appends unknown names alphabetically", () => {
    const flat = flattenMembers(tree);
    const result = orderedNamesFromMembers(flat, ["Zzz Dept", "GPU Cloud", "Aaa Dept"]);
    expect(result[result.length - 2]).toBe("Aaa Dept");
    expect(result[result.length - 1]).toBe("Zzz Dept");
    expect(result).toContain("GPU Cloud");
  });
});

// ---------------------------------------------------------------------------
// orderedOptionsFromMembers
// ---------------------------------------------------------------------------

describe("orderedOptionsFromMembers", () => {
  it("returns hierarchy options followed by unknown options at depth 0", () => {
    const result = orderedOptionsFromMembers(tree, ["Unknown Dept"]);
    const unknown = result.find((o) => o.name === "Unknown Dept");
    expect(unknown).toBeDefined();
    expect(unknown?.depth).toBe(0);
    // hierarchy members come first
    expect(result[0].name).toBe("Total Company");
  });

  it("deduplicates fallback names", () => {
    const result = orderedOptionsFromMembers([], ["A", "A", "B"]);
    expect(result.filter((o) => o.name === "A")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// compareDimensionMembers
// ---------------------------------------------------------------------------

describe("compareDimensionMembers", () => {
  it("sorts by sortOrder numerically", () => {
    const a = member("B", [], null, 1);
    const b = member("A", [], null, 2);
    expect(compareDimensionMembers(a, b)).toBeLessThan(0);
  });

  it("falls back to alphabetical when sortOrder is equal", () => {
    const a = member("B", [], null, 1);
    const b = member("A", [], null, 1);
    expect(compareDimensionMembers(a, b)).toBeGreaterThan(0);
  });

  it("treats undefined sortOrder as Infinity", () => {
    const a = member("A");
    const b = member("B", [], null, 1);
    expect(compareDimensionMembers(a, b)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// cloneDimensionTreeWithSort
// ---------------------------------------------------------------------------

describe("cloneDimensionTreeWithSort", () => {
  it("updates the sort order of the target member", () => {
    const result = cloneDimensionTreeWithSort(tree, "Engineering", 0.5);
    const flat = flattenMembers(result);
    const eng = flat.find((m) => m.name === "Engineering");
    expect(eng?.sortOrder).toBe(0.5);
  });

  it("does not mutate the original tree", () => {
    cloneDimensionTreeWithSort(tree, "Engineering", 0.5);
    const eng = flattenMembers(tree).find((m) => m.name === "Engineering");
    expect(eng?.sortOrder).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// updateDimensionSortOrder
// ---------------------------------------------------------------------------

describe("updateDimensionSortOrder", () => {
  const dims: Dimensions = { department: tree, account: [], time: [] };

  it("updates the named dimension kind", () => {
    const result = updateDimensionSortOrder(dims, "department", "Engineering", 0.5);
    const eng = flattenMembers(result.department).find((m) => m.name === "Engineering");
    expect(eng?.sortOrder).toBe(0.5);
  });

  it("returns unchanged dimensions for time kind", () => {
    const result = updateDimensionSortOrder(dims, "time", "2026-01", 1);
    expect(result).toBe(dims);
  });
});

// ---------------------------------------------------------------------------
// dimensionTitle
// ---------------------------------------------------------------------------

describe("dimensionTitle", () => {
  it("returns correct titles", () => {
    expect(dimensionTitle("department")).toBe("Department");
    expect(dimensionTitle("account")).toBe("Account");
    expect(dimensionTitle("time")).toBe("Time");
  });
});

// ---------------------------------------------------------------------------
// isMonth
// ---------------------------------------------------------------------------

describe("isMonth", () => {
  it("returns true for YYYY-MM strings", () => {
    expect(isMonth("2026-01")).toBe(true);
    expect(isMonth("2025-12")).toBe(true);
  });

  it("returns false for year strings", () => {
    expect(isMonth("2026")).toBe(false);
  });

  it("returns false for arbitrary strings", () => {
    expect(isMonth("Q1 2026")).toBe(false);
    expect(isMonth("")).toBe(false);
  });
});
