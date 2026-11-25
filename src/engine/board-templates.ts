import type { Document, NodeId } from "./document";
import { createLayer } from "./creation";

/** Source: upstream engine/src/boards/board_templates.rs: ready-made layouts placed as ordinary board objects in one undo step. */
export interface BoardTemplate { readonly id: string; readonly name: string; readonly description: string; readonly size: readonly [number, number] }
export const templates: readonly BoardTemplate[] = Object.freeze([
  { id: "retrospective", name: "Retrospective", description: "Three sections to look back on a stretch of work: what went well, what to improve, what to do next", size: [1280, 592] },
  { id: "brainstorm", name: "Brainstorm", description: "A question in the middle and four clusters of ideas around it", size: [1344, 760] },
  { id: "weeklyPlanner", name: "Weekly planner", description: "A column for each working day with a note to start from", size: [1380, 632] },
  { id: "flowChart", name: "Flow chart", description: "Steps, a decision and its two outcomes joined by connectors", size: [1220, 360] },
  { id: "kanban", name: "Kanban board", description: "To do, Doing and Done columns with cards to move along", size: [900, 812] },
]);
/** Native `board.templates`. */
export const templateList = () => templates.map(t => ({ description: t.description, height: t.size[1], id: t.id, name: t.name, width: t.size[0] }));
/** Native `find`: a template by id, or by name in any case. */
export const findTemplate = (name: string) => templates.find(t => t.id.toLowerCase() === name.trim().toLowerCase() || t.name.toLowerCase() === name.trim().toLowerCase());
/** Every text the templates write (for preparing fonts). */
export const templateTexts = "Retrospective Went well To improve Next steps Something that helped us A win worth repeating Something that slowed us down A question we still have One change to try next Who looks after it? What are we trying to solve? An idea Build on it This week Monday Tuesday Wednesday Thursday Friday Plan the week Focus for the day Wrap up and share Start Do the first step Did it work? Carry on Done Try another way Yes No Team board To do Doing Write the brief Sketch the first screens Plan a test session Review the copy Set up the board";

/** What a template needs: running a board command, and native's `node.create`, on the document as it goes. */
export interface TemplateRun { board(command: string, p: Record<string, unknown>): Record<string, unknown>; create(p: Record<string, unknown>): string }
/** Native `Builder`: places a template's objects from its top-left `at`; the layers it placed on the page. */
export function buildTemplate(id: string, page: NodeId, at: readonly [number, number], run: TemplateRun): number[] {
  const made: number[] = [];
  const placed = (p: Record<string, unknown>, parent: NodeId, x: number, y: number) => ({ ...p, parent: Number(parent), x, y });
  const top = (command: string, x: number, y: number, p: Record<string, unknown>) => {
    const q = placed(p, page, at[0] + x, at[1] + y);
    const id = command === "node.create" ? Number(run.create(q)) : (run.board(command, q).id as number);
    made.push(id);
    return id;
  };
  const title = (text: string) => top("node.create", 0, 0, { type: "text", text, props: { fontSize: 32, fills: ["#1E1E1E"] } });
  const section = (name: string, [x, y, w, h]: readonly number[], fill: string) => top("node.create", x, y, { type: "section", name, width: w, height: h, props: { fills: [fill] } });
  const sticky = (sec: number | undefined, [x, y]: readonly number[], text: string, color: string) => {
    const p = { text, color, author: false };
    return sec !== undefined ? run.board("board.sticky", placed(p, String(sec), x, y)).id as number : top("board.sticky", x, y, p);
  };
  const shape = (s: string, [x, y, w, h]: readonly number[], text: string, color: string) => top("board.shape", x, y, { shape: s, width: w, height: h, text, color });
  const connector = (from: number, to: number, extra: Record<string, unknown>) => { const id = run.board("board.connector", { ...extra, from, to }).id as number; made.push(id); return id; };
  switch (id) {
    case "retrospective": {
      title("Retrospective");
      const parts = [["Went well", "#EAF6E1", "green", ["Something that helped us", "A win worth repeating"]], ["To improve", "#FCE8EF", "pink", ["Something that slowed us down", "A question we still have"]],
        ["Next steps", "#E6F0FC", "blue", ["One change to try next", "Who looks after it?"]]] as const;
      parts.forEach(([name, fill, color, notes], i) => { const sec = section(name, [i * 440, 72, 400, 520], fill); notes.forEach((n, j) => sticky(sec, [100, 60 + j * 230], n, color)); });
      break;
    }
    case "brainstorm": {
      const topic = shape("ellipse", [532, 300, 280, 160], "What are we trying to solve?", "violet");
      for (const [[x, y], color, near] of [[[0, 0], "yellow", 1], [[920, 0], "orange", 0], [[0, 560], "green", 1], [[920, 560], "blue", 0]] as const) {
        const notes = [sticky(undefined, [x, y], "An idea", color), sticky(undefined, [x + 224, y], "Build on it", color)];
        connector(topic, notes[near], { style: "straight", endCap: "none" });
      }
      break;
    }
    case "weeklyPlanner": {
      title("This week");
      [["Monday", "Plan the week"], ["Tuesday", "Focus for the day"], ["Wednesday", "Focus for the day"], ["Thursday", "Focus for the day"], ["Friday", "Wrap up and share"]]
        .forEach(([day, note], i) => { const sec = section(day, [i * 280, 72, 260, 560], "#FFFFFF"); sticky(sec, [30, 60], note, i % 2 === 0 ? "yellow" : "orange"); });
      break;
    }
    case "flowChart": {
      const start = shape("ellipse", [0, 30, 160, 100], "Start", "green"), step = shape("rectangle", [240, 20, 180, 120], "Do the first step", "blue");
      const check = shape("diamond", [500, 0, 200, 160], "Did it work?", "yellow"), carry = shape("roundedRectangle", [800, 20, 180, 120], "Carry on", "blue");
      const done = shape("ellipse", [1060, 30, 160, 100], "Done", "green"), other = shape("roundedRectangle", [510, 240, 180, 120], "Try another way", "orange");
      connector(start, step, { style: "elbow" }); connector(step, check, { style: "elbow" });
      connector(check, carry, { style: "elbow", label: "Yes" }); connector(carry, done, { style: "elbow" });
      connector(check, other, { style: "elbow", fromSide: "bottom", toSide: "top", label: "No" });
      // Back round to the step: out of the side, into the step from below.
      connector(other, step, { style: "elbow", fromSide: "left", toSide: "bottom" });
      break;
    }
    case "kanban": {
      title("Team board");
      ([["To do", "yellow", ["Write the brief", "Sketch the first screens", "Plan a test session"]], ["Doing", "blue", ["Review the copy"]], ["Done", "green", ["Set up the board"]]] as const)
        .forEach(([name, color, cards], i) => { const sec = section(name, [i * 310, 72, 280, 740], "#FFFFFF"); cards.forEach((c, j) => sticky(sec, [40, 60 + j * 220], c, color)); });
      break;
    }
  }
  return made;
}
/** Native `node.create` on a document as a template goes (no view: the template gives every place). */
export function createOn(state: { doc: Document; next: bigint }, p: Record<string, unknown>): string {
  const made = createLayer({ document: state.doc, selection: [] }, state.next, "node.create", p, { cx: 0, cy: 0, zoom: 1, vw: 1, vh: 1 } as never);
  state.doc = made.document; state.next = made.nextId;
  return made.id;
}
