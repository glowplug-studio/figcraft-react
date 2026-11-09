import {pixelRound} from "./geometry";

export type FieldEdit = {kind: "set" | "add" | "multiply" | "divide"; value: number};

/** The native numeric field grammar. Arithmetic never executes browser script. */
export function parseFieldEdit(input: string, percentUnit = false): FieldEdit | undefined {
  const trim = (s: string) => s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu,"");
  const text = trim(input);
  if (!text || text.length > 256 || new TextEncoder().encode(text).length > 256) return;
  const percent = !percentUnit && text.endsWith("%");
  const body = trim(percent ? text.slice(0,-1) : text);
  const lead = "+*/".includes(body[0]) ? body[0] : undefined;
  let index = lead ? 1 : 0;
  const space = () => {while (index < body.length && /\p{White_Space}/u.test(body[index])) index++;};
  function eat(ch: string) {
    space();
    if (body[index] !== ch) return false;
    index++;
    return true;
  }
  function factor(depth: number): number {
    if (depth > 32) return NaN;
    if (eat("-")) return -factor(depth+1);
    if (eat("(")) {
      const value = sum(depth+1);
      return eat(")") ? value : NaN;
    }
    const start = index;
    while (index < body.length && /[0-9.,]/.test(body[index])) index++;
    if (index === start) return NaN;
    const value = Number(body.slice(start,index).replaceAll(",","."));
    space();
    while (index < body.length && (/[A-Za-z°]/.test(body[index]) || (percentUnit && body[index] === "%"))) index++;
    return value;
  }
  function product(depth: number) {
    let value = factor(depth);
    while (true) {
      if (eat("*")) value *= factor(depth);
      else if (eat("/")) {
        const divisor = factor(depth);
        value = divisor === 0 ? NaN : value/divisor;
      } else return value;
    }
  }
  function sum(depth: number) {
    let value = product(depth);
    while (true) {
      if (eat("+")) value += product(depth);
      else if (eat("-")) value -= product(depth);
      else return value;
    }
  }
  const value = sum(0);
  if (!Number.isFinite(value) || index !== body.length) return;
  if (percent) {
    if (lead === "/") return {kind:"divide",value:value/100};
    const relative = lead === "+" || (!lead && body.startsWith("-"));
    return {kind:"multiply",value:(relative ? 1 : 0)+value/100};
  }
  const kind = lead === "+" ? "add" : lead === "*" ? "multiply" : lead === "/" ? "divide" : "set";
  return {kind,value};
}

export function fieldValue(edit: FieldEdit | undefined, current?: number): number | undefined {
  if (!edit) return;
  if (edit.kind === "set") return edit.value;
  if (current === undefined) return edit.kind === "add" ? edit.value : undefined;
  const result = edit.kind === "add" ? current+edit.value : edit.kind === "multiply" ? current*edit.value : current/edit.value;
  return Number.isFinite(result) ? result : undefined;
}

export function steppedField(from: number, steps: number, step: number) {
  const value = from+steps*step;
  if (!Number.isFinite(value)) return from;
  const rounded = pixelRound(value*1e6)/1e6;
  return Number.isFinite(rounded) ? rounded : value;
}
