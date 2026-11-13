import { expect, test } from "vitest";
import { forkPrefix } from "./fork.js";

test.each([
  {
    name: "disjoint streams",
    child: ["c", "d"],
    parent: ["a", "b"],
    expected: [],
  },
  {
    name: "contiguous copied prefix",
    child: ["b", "c", "d"],
    parent: ["a", "b", "c"],
    expected: ["b", "c"],
  },
  {
    name: "additional overlap after the prefix",
    child: ["a", "b", "d", "c"],
    parent: ["a", "b", "c"],
    expected: undefined,
  },
  {
    name: "out-of-order records",
    child: ["b", "a", "d"],
    parent: ["a", "b"],
    expected: undefined,
  },
  {
    name: "a single coincidental match",
    child: ["a", "d"],
    parent: ["a", "b"],
    expected: undefined,
  },
  { name: "missing evidence", child: ["a"], parent: [], expected: undefined },
])("classifies $name", ({ child, parent, expected }) => {
  const result = forkPrefix(child, parent);
  expect(result === undefined ? undefined : [...result]).toEqual(expected);
});
