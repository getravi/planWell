/**
 * @module dimension-utils
 * Pure utility functions for working with PlanWell dimension trees.
 *
 * Dimensions are stored as nested `DimensionMember` trees and these helpers
 * provide flattening, ordering, ancestor/descendant lookups, and sort-order
 * mutations used by the Dimensions, Time Settings, Forecast, and Comparison views.
 */

import type { DimensionKind, DimensionMember, Dimensions } from "../domain/types.ts";

/** A flat select-option representation of a dimension member with its depth. */
export type DimensionSelectOption = {
  depth: number;
  name: string;
};

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

/**
 * Flattens a nested dimension tree into a depth-first ordered list of members.
 * Children appear immediately after their parent.
 */
export function flattenMembers(members: DimensionMember[]): DimensionMember[] {
  return members.flatMap((member) => [member, ...flattenMembers(member.children)]);
}

/**
 * Flattens a nested dimension tree into a list of `{ name, depth }` select options.
 * Depth starts at 0 for root members and increases by 1 per level.
 */
export function flattenMembersWithDepth(
  members: DimensionMember[],
  depth = 0,
): DimensionSelectOption[] {
  return members.flatMap((member) => [
    { depth, name: member.name },
    ...flattenMembersWithDepth(member.children, depth + 1),
  ]);
}

// ---------------------------------------------------------------------------
// Ordering helpers
// ---------------------------------------------------------------------------

/**
 * Returns a depth-first ordered list of member names that appear in `fallbackNames`,
 * appending any unknown names (sorted alphabetically) at the end.
 *
 * Useful for building ordered department/account name lists that respect the
 * dimension hierarchy while still surfacing cube rows that have no hierarchy entry.
 */
export function orderedNamesFromMembers(
  members: DimensionMember[],
  fallbackNames: string[],
): string[] {
  const memberNames = flattenMembers(members).map((member) => member.name);
  const knownNames = new Set(memberNames);
  const unknownNames = [...new Set(fallbackNames)]
    .filter((name) => !knownNames.has(name))
    .sort((left, right) => left.localeCompare(right));
  return [...memberNames, ...unknownNames];
}

/**
 * Returns ordered `DimensionSelectOption` entries for members that appear in
 * `fallbackNames`, appending unknown names (depth 0) alphabetically.
 */
export function orderedOptionsFromMembers(
  members: DimensionMember[],
  fallbackNames: string[],
): DimensionSelectOption[] {
  const memberOptions = flattenMembersWithDepth(members);
  const knownNames = new Set(memberOptions.map((member) => member.name));
  const unknownOptions = [...new Set(fallbackNames)]
    .filter((name) => !knownNames.has(name))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({ depth: 0, name }));
  return [...memberOptions, ...unknownOptions];
}

// ---------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------

/**
 * Builds a map from each member name to the full list of its descendant names
 * (including itself). Used for filtering rows by a selected ancestor department.
 */
export function buildDescendantLookup(members: DimensionMember[]): Map<string, string[]> {
  const lookup = new Map<string, string[]>();
  const visit = (member: DimensionMember): string[] => {
    const descendants = member.children.flatMap(visit);
    const names = [member.name, ...descendants];
    lookup.set(member.name, names);
    return names;
  };
  for (const member of members) {
    visit(member);
  }
  return lookup;
}

/**
 * Builds a map from each member name to an ordered list of its ancestor names
 * (from root down to parent). Used for driver inheritance resolution.
 */
export function buildAncestorLookup(members: DimensionMember[]): Map<string, string[]> {
  const lookup = new Map<string, string[]>();
  const visit = (member: DimensionMember, ancestors: string[]) => {
    lookup.set(member.name, ancestors);
    for (const child of member.children) {
      visit(child, [...ancestors, member.name]);
    }
  };
  for (const member of members) {
    visit(member, []);
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Sort-order mutations (optimistic UI)
// ---------------------------------------------------------------------------

/**
 * Returns a comparison function that sorts `DimensionMember` objects by
 * `sortOrder` (ascending), falling back to alphabetical order.
 */
export function compareDimensionMembers(left: DimensionMember, right: DimensionMember): number {
  return (
    (left.sortOrder ?? Number.POSITIVE_INFINITY) - (right.sortOrder ?? Number.POSITIVE_INFINITY) ||
    left.name.localeCompare(right.name)
  );
}

/**
 * Clones a dimension tree, updating the `sortOrder` of a single member by name.
 * The resulting list is re-sorted so the UI reflects the new order immediately.
 */
export function cloneDimensionTreeWithSort(
  members: DimensionMember[],
  memberName: string,
  sortOrder: number,
): DimensionMember[] {
  return members
    .map((member) => ({
      ...member,
      sortOrder: member.name === memberName ? sortOrder : member.sortOrder,
      children: cloneDimensionTreeWithSort(member.children, memberName, sortOrder),
    }))
    .sort(compareDimensionMembers);
}

/**
 * Returns an updated `Dimensions` object with the sort order of a single member
 * changed. Time dimensions are not re-ordered (returns the original unchanged).
 */
export function updateDimensionSortOrder(
  dimensions: Dimensions,
  kind: DimensionKind,
  memberName: string,
  sortOrder: number,
): Dimensions {
  if (kind === "time") {
    return dimensions;
  }
  return {
    ...dimensions,
    [kind]: cloneDimensionTreeWithSort(dimensions[kind], memberName, sortOrder),
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable title for a dimension kind.
 * @example dimensionTitle("department") → "Department"
 */
export function dimensionTitle(kind: DimensionKind): string {
  if (kind === "department") return "Department";
  if (kind === "account") return "Account";
  return "Time";
}

/**
 * Returns `true` when the value is a valid YYYY-MM month string.
 * Used to distinguish leaf month members from year aggregates in the time dimension.
 */
export function isMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}
