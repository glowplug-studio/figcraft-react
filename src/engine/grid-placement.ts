import type { Document, DocumentNode, FrameLikeNode, NodeId } from "./document";

export interface GridCell {
  readonly column: number;
  readonly row: number;
  readonly columnSpan: number;
  readonly rowSpan: number;
}
type PendingCell = {id: NodeId; column?: number; row?: number; columnSpan: number; rowSpan: number};

function wordMask(word: number, start: number, end: number) {
  const lo = Math.max(0, start - word * 32);
  const hi = Math.min(32, end - word * 32);
  return (0xffffffff << lo) & (0xffffffff >>> (32 - hi));
}

function lastOccupied(words: Uint32Array, column: number, span: number) {
  const end = column + span;
  for (let word = (end - 1) >>> 5; word >= column >>> 5; word--) {
    const taken = words[word] & wordMask(word, column, end);
    if (taken) return word * 32 + 31 - Math.clz32(taken);
  }
  return -1;
}

/** Native grid_place uses row-major occupancy. Allocate words only for occupied rows. */
class Occupancy {
  readonly rows = new Map<number, Uint32Array>();
  readonly scratch: Uint32Array;

  constructor(readonly columns: number) {
    this.scratch = new Uint32Array(Math.ceil(columns / 32));
  }

  mark(cell: GridCell) {
    const end = cell.column + cell.columnSpan;
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
      let bits = this.rows.get(r);
      if (!bits) this.rows.set(r, bits = new Uint32Array(this.scratch.length));
      for (let w = cell.column >>> 5; w <= (end - 1) >>> 5; w++) bits[w] |= wordMask(w, cell.column, end);
    }
  }

  firstColumn(row: number, from: number, width: number, height: number) {
    this.scratch.fill(0);
    for (let r = row; r < row + height; r++) {
      const bits = this.rows.get(r);
      if (bits) for (let w = 0; w < bits.length; w++) this.scratch[w] |= bits[w];
    }
    for (let c = from; c + width <= this.columns;) {
      const last = lastOccupied(this.scratch, c, width);
      if (last < 0) return c;
      c = last + 1;
    }
    return undefined;
  }

  firstRow(column: number, from: number, last: number, width: number, height: number) {
    let free = 0;
    for (let r = from; r < last + height; r++) {
      const bits = this.rows.get(r);
      free = bits && lastOccupied(bits, column, width) >= 0 ? 0 : free + 1;
      if (free === height) return r + 1 - height;
    }
    return undefined;
  }
}

function computeGridCells(doc: Document, frame: FrameLikeNode) {
  const layout = frame.layout!;
  const columns = Math.min(1000, Math.max(1, layout.gridColumns));
  const maxRows = Math.min(1000, Math.floor(1_000_000 / columns));
  let rows = Math.min(1000, Math.max(1, layout.gridRows));
  // Unanchored unit cells occupy consecutive slots, including when hidden siblings are skipped.
  const plain = frame.children.every(id => {
    const child = doc.nodes[id];
    if (!child || child.kind === "page" || child.visible === false || child.childLayout?.absolute) return true;
    const cl = child.childLayout;
    return !cl || (cl.gridColumn === undefined && cl.gridRow === undefined &&
      (cl.gridColumnSpan ?? 0) <= 1 && (cl.gridRowSpan ?? 0) <= 1);
  });
  if (plain) {
    const cells = new Map<NodeId, GridCell>();
    const capacity = columns * maxRows;
    for (const id of frame.children) {
      const child = doc.nodes[id];
      if (!child || child.kind === "page" || child.visible === false || child.childLayout?.absolute) continue;
      const at = cells.size, row = Math.min(maxRows-1, Math.floor(at / columns));
      cells.set(id, {column: at < capacity ? at % columns : 0, row, columnSpan: 1, rowSpan: 1});
    }
    return {columns, rows: Math.max(rows, Math.min(maxRows, Math.ceil(cells.size / columns))), cells};
  }
  const occupancy = new Occupancy(columns);
  const cells = new Map<NodeId, GridCell>();
  const pending: PendingCell[] = [];
  const placed = (id: NodeId, column: number, row: number, columnSpan: number, rowSpan: number) => {
    const cell = {column, row, columnSpan, rowSpan};
    occupancy.mark(cell);
    cells.set(id, cell);
    rows = Math.max(rows, row + rowSpan);
  };

  for (const id of frame.children) {
    const child = doc.nodes[id];
    if (!child || child.kind === "page" || child.visible === false || child.childLayout?.absolute) continue;
    const props = child.childLayout;
    const columnSpan = Math.min(columns, Math.max(1, props?.gridColumnSpan ?? 0));
    const rowSpan = Math.min(maxRows, Math.max(1, props?.gridRowSpan ?? 0));
    const column = props?.gridColumn === undefined ? undefined : Math.min(props.gridColumn, columns - columnSpan);
    const row = props?.gridRow === undefined ? undefined : Math.min(props.gridRow, maxRows - rowSpan);
    if (column !== undefined && row !== undefined) placed(id, column, row, columnSpan, rowSpan);
    else pending.push({id, column, row, columnSpan, rowSpan});
  }

  let cursorRow = 0, cursorColumn = 0;
  const nextRow = new Map<string, number>();
  for (const {id, columnSpan, rowSpan, ...anchor} of pending) {
    let {column, row} = anchor;
    const last = maxRows - rowSpan;
    if (column !== undefined) {
      const key = `${column}/${columnSpan}/${rowSpan}`;
      const found = occupancy.firstRow(column, nextRow.get(key) ?? 0, last, columnSpan, rowSpan);
      nextRow.set(key, found ?? last + 1);
      row = found ?? last;
    } else if (row !== undefined) {
      column = occupancy.firstColumn(row, 0, columnSpan, rowSpan) ?? 0;
    } else {
      while (cursorRow <= last) {
        column = occupancy.firstColumn(cursorRow, cursorColumn, columnSpan, rowSpan);
        if (column !== undefined) break;
        cursorRow++;
        cursorColumn = 0;
      }
      row = Math.min(cursorRow, last);
      column ??= 0;
      cursorRow = row;
      cursorColumn = column + columnSpan;
    }
    placed(id, column, row!, columnSpan, rowSpan);
  }
  // Geometry consumers iterate in layer order even when later children were anchored first.
  const ordered = new Map<NodeId, GridCell>();
  for (const id of frame.children) {
    const cell = cells.get(id);
    if (cell) ordered.set(id, cell);
  }
  return {columns, rows, cells: ordered};
}

// Gap and track previews change positions and sizes, but not occupancy. Retain one placement
// per immutable child order and check the placement-relevant inputs before reusing it.
function placementState(node: DocumentNode | undefined) {
  if (!node || node.kind === "page" || node.visible === false || node.childLayout?.absolute) return false;
  return node.childLayout ?? true;
}

const placements = new WeakMap<readonly NodeId[], {
  columns: number; rows: number;
  states: readonly ReturnType<typeof placementState>[];
  grid: ReturnType<typeof computeGridCells>;
}>();

export function placeGridCells(doc: Document, frame: FrameLikeNode) {
  const { children, layout } = frame;
  if (children.length < 128) return computeGridCells(doc, frame);
  const previous = placements.get(children);
  if (previous && previous.columns === layout!.gridColumns && previous.rows === layout!.gridRows
    && children.every((id, index) => previous.states[index] === placementState(doc.nodes[id]))) return previous.grid;
  const grid = computeGridCells(doc, frame);
  placements.set(children, { columns: layout!.gridColumns, rows: layout!.gridRows,
    states: children.map(id => placementState(doc.nodes[id])), grid });
  return grid;
}

const inspected = new WeakMap<Document, Map<NodeId, ReturnType<typeof placeGridCells>>>();
export function inspectedGridCell(doc: Document, frame: FrameLikeNode, id: NodeId) {
  let grids = inspected.get(doc);
  if (!grids) inspected.set(doc, grids = new Map());
  let grid = grids.get(frame.id);
  if (!grid) grids.set(frame.id, grid = placeGridCells(doc, frame));
  return grid.cells.get(id);
}
