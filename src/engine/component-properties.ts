import { isLosslessNumber } from "lossless-json";
import { fail, id, wireId } from "./native-values";
import { compareScalarKeys } from "./text-breaks";

export type ComponentProperty =
  | { readonly type: "boolean"; readonly default: boolean }
  | { readonly type: "text"; readonly default: string }
  | { readonly type: "instanceSwap"; readonly default: string; readonly preferred: readonly string[] }
  | { readonly type: "variant"; readonly default: string; readonly options: readonly string[] }
  | { readonly type: "slot"; readonly preferred: readonly string[] };

export type ComponentProperties = Readonly<Record<string, ComponentProperty>>;

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isLosslessNumber(value)) {
    fail(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array<T>(value: unknown, path: string, read: (entry: unknown, path: string) => T): readonly T[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return Object.freeze(value.map((entry, index) => read(entry, `${path}/${index}`)));
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string") fail(`${path} must be text`);
  return value;
}

function readDefinition(value: unknown, path: string): ComponentProperty {
  const definition = record(value, path);
  switch (definition.type) {
    case "boolean":
      if (typeof definition.default !== "boolean") fail(`${path}/default must be boolean`);
      return Object.freeze({ type: "boolean", default: definition.default });
    case "text":
      return Object.freeze({ type: "text", default: text(definition.default, path + "/default") });
    case "variant":
      return Object.freeze({ type: "variant", default: text(definition.default, path + "/default"),
        options: array(definition.options, path + "/options", text) });
    case "slot":
    case "instanceSwap": {
      const preferred = array(definition.preferred === undefined ? [] : definition.preferred, path + "/preferred", id);
      if (definition.type === "slot") return Object.freeze({ type: "slot", preferred });
      return Object.freeze({ type: "instanceSwap", default: id(definition.default, path + "/default"), preferred });
    }
    default:
      return fail(`${path}/type is not a component property type`);
  }
}

export function readComponentProperties(value: unknown): ComponentProperties {
  const entries = Object.entries(record(value, "component properties"));
  return Object.freeze(Object.fromEntries(entries.map(([key, definition]) =>
    [key, readDefinition(definition, "component properties/" + key)])));
}

export function orderedComponentPropertyNames(properties: ComponentProperties, order: readonly string[]): string[] {
  const names = new Set(order.filter(key => Object.hasOwn(properties, key)));
  for (const name of Object.keys(properties).sort(compareScalarKeys)) names.add(name);
  return [...names];
}

export function wireComponentProperties(properties: ComponentProperties) {
  return Object.fromEntries(Object.entries(properties).map(([key, definition]) => {
    switch (definition.type) {
      case "instanceSwap":
        return [key, { type: definition.type, default: wireId(definition.default),
          ...(definition.preferred.length && { preferred: definition.preferred.map(wireId) }) }];
      case "slot":
        return [key, { type: definition.type, preferred: definition.preferred.map(wireId) }];
      default:
        return [key, definition];
    }
  }));
}

export interface ComponentLinks {
  readonly source?: string;
  readonly overrides?: readonly string[];
  readonly propRefs?: Readonly<Record<string, string>>;
  readonly exposed?: true;
}

const emptyLinks = Object.freeze({});

export function readComponentLinks(node: Record<string, unknown>): ComponentLinks {
  if (node.source == null && node.overrides === undefined && node.prop_refs === undefined && node.exposed === undefined) return emptyLinks;
  const source = node.source == null ? undefined : id(node.source, "source");
  const overrides = node.overrides === undefined ? [] : [...new Set(array(node.overrides, "overrides", text))].sort(compareScalarKeys);
  const refs = node.prop_refs === undefined ? [] : Object.entries(record(node.prop_refs, "prop_refs"));
  const propRefs = Object.fromEntries(refs.map(([key, value]) => [key, text(value, "prop_refs/" + key)]));
  if (node.exposed !== undefined && typeof node.exposed !== "boolean") fail("exposed must be boolean");
  const groups = node.type === "text" ? overrides.filter(name => name !== "characters") : overrides;
  return { ...(source !== undefined && {source}), ...(groups.length && {overrides:Object.freeze(groups)}),
    ...(refs.length && {propRefs:Object.freeze(propRefs)}), ...(node.exposed === true && {exposed:true}) };
}

// Text nodes created before component support store this single override as a flag.
export function componentOverrides(node: ComponentLinks & { readonly charactersOverridden?: true }): readonly string[] {
  const overrides = node.overrides ?? [];
  if (!node.charactersOverridden || overrides.includes("characters")) return overrides;
  return [...overrides, "characters"].sort(compareScalarKeys);
}

export function wireComponentLinks(node: ComponentLinks & { readonly charactersOverridden?: true }) {
  const overrides = componentOverrides(node);
  return { ...(node.source !== undefined && {source:wireId(node.source)}), ...(node.exposed && {exposed:true}),
    ...(overrides.length && {overrides}), ...(node.propRefs && {prop_refs:node.propRefs}) };
}

export interface ComponentMain {
  readonly kind: "component";
  readonly description: string;
  readonly props: ComponentProperties;
  readonly propOrder: readonly string[];
}

export const newComponentKind: ComponentMain = Object.freeze({
  kind:"component", description:"", props:Object.freeze({}), propOrder:Object.freeze([]),
});

export interface ComponentSet {
  readonly kind: "componentSet";
  readonly description: string;
}

export type InstanceValue = string | boolean | null | number | import("lossless-json").LosslessNumber
  | readonly InstanceValue[] | { readonly [key: string]: InstanceValue };

export interface ComponentInstance {
  readonly kind: "instance";
  readonly component: string;
  readonly props: Readonly<Record<string, InstanceValue>>;
}

function instanceValue(value: unknown): InstanceValue {
  if (isLosslessNumber(value)) {
    if (!Number.isFinite(Number(value.value))) fail("instance property number is outside the native range");
    return Object.freeze(value);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(instanceValue));
  return readInstanceValues(value);
}

function readInstanceValues(value: unknown): ComponentInstance["props"] {
  return Object.freeze(Object.fromEntries(Object.entries(record(value, "instance properties"))
    .map(([key, member]) => [key, instanceValue(member)])));
}

export function readFrameKind(kind: "frame" | "component" | "componentSet" | "instance", node: Record<string, unknown>):
  {kind: "frame"} | ComponentMain | ComponentSet | ComponentInstance {
  if (kind === "frame") return {kind};
  const props = node.props === undefined ? {} : node.props;
  if (kind === "instance") return {kind, component:id(node.component, "instance component"), props:readInstanceValues(props)};
  const description = text(node.description === undefined ? "" : node.description, "component description");
  if (kind === "componentSet") return {kind, description};
  const propOrder = array(node.prop_order === undefined ? [] : node.prop_order, "component property order", text);
  return {kind, description, props:readComponentProperties(props), propOrder};
}

export function wireFrameKind(node: ComponentMain | ComponentSet | ComponentInstance | {kind:"frame"}) {
  switch (node.kind) {
    case "frame": return {};
    case "instance": return {component:wireId(node.component), props:node.props};
    case "componentSet": return {description:node.description};
    case "component": return {description:node.description, props:wireComponentProperties(node.props),
      ...(node.propOrder.length && {prop_order:node.propOrder})};
  }
}

// The command API uses strings for integers that cannot be represented exactly in JavaScript.
export function inspectedPropertyValues(value: unknown): unknown {
  if (isLosslessNumber(value)) {
    const numeric = Number(value.value);
    return !Number.isSafeInteger(numeric) && /^-?\d+$/.test(value.value) ? value.value : numeric;
  }
  if (Array.isArray(value)) return value.map(inspectedPropertyValues);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .map(([key, member]) => [key, inspectedPropertyValues(member)]));
  return value;
}
