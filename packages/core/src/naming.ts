import manifest from "../../../package.json" with { type: "json" };

export const NAMING = manifest.naming;
export const PRODUCT_NAME = NAMING.displayName;
