/**
 * Pure position math for the layout-tree drag surfaces (contract §7):
 * pointer position over a tree row + the doc → the {containerId, index, slot}
 * a drop there would splice into. No DOM types beyond a plain rect, so the
 * whole resolution is unit-testable.
 */
import type { SurfaceDoc } from './surface-doc';
import { CONTAINER_COMPONENTS } from './surface-doc';

export type TreeDropZone = 'before' | 'after' | 'into';

/** The vertical slice of the row rect the resolution cares about. */
export interface RowRect {
  top: number;
  height: number;
}

export interface TreeDropTarget {
  containerId: string;
  index: number;
  slot: TreeDropZone;
}

export interface TreeDropResolution {
  /** Which zone of the row the pointer is in (drives the indicator). */
  zone: TreeDropZone;
  /** The resolved splice position, or null when the zone has no valid target. */
  target: TreeDropTarget | null;
}

function isContainerRow(doc: SurfaceDoc, rowId: string): boolean {
  const row = doc.components.find((c) => c.id === rowId);
  return row !== undefined && CONTAINER_COMPONENTS.has(row.component);
}

/**
 * Zone by thirds of the row rect (contract §7): upper third → 'before',
 * lower third → 'after', middle third → 'into' — but only container rows can
 * take 'into'; for leaf rows the middle behaves as before/after by half.
 * Degenerate rects (height <= 0) resolve as the middle.
 */
export function zoneForPointer(rect: RowRect, clientY: number, isContainer: boolean): TreeDropZone {
  const rel = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  if (isContainer) {
    if (rel < 1 / 3) return 'before';
    if (rel > 2 / 3) return 'after';
    return 'into';
  }
  return rel < 0.5 ? 'before' : 'after';
}

/**
 * Resolves a zone on a row against the doc:
 * - 'into' → the row itself must be a children-array container (Row/Column/
 *   List); index = end of its children.
 * - 'before'/'after' → the ROW'S PARENT's children array, at the row's own
 *   position (plus one for 'after'). Rows without such a parent — the root
 *   row, single-slot occupants (a Card's `child`, Modal panes, …), orphans —
 *   have no before/after position and resolve to null.
 *
 * Indices are positions in the CURRENT children array. For move-type drops
 * feed the result through moveIndexFor, which applies the after-removal rule
 * of contract §5.
 */
export function resolveTreeDrop(
  doc: SurfaceDoc,
  rowId: string,
  zone: TreeDropZone,
): TreeDropTarget | null {
  if (zone === 'into') {
    const row = doc.components.find((c) => c.id === rowId);
    if (!row || !CONTAINER_COMPONENTS.has(row.component)) return null;
    const children = Array.isArray(row.children) ? row.children : [];
    return { containerId: rowId, index: children.length, slot: 'into' };
  }
  const parent = doc.components.find(
    (c) =>
      c.id !== rowId &&
      CONTAINER_COMPONENTS.has(c.component) &&
      Array.isArray(c.children) &&
      c.children.includes(rowId),
  );
  if (!parent || !Array.isArray(parent.children)) return null;
  const position = parent.children.indexOf(rowId);
  return {
    containerId: parent.id,
    index: zone === 'after' ? position + 1 : position,
    slot: zone,
  };
}

/** zoneForPointer + resolveTreeDrop in one call — what the tree rows use. */
export function dropTargetForPointer(
  doc: SurfaceDoc,
  rowId: string,
  rect: RowRect,
  clientY: number,
): TreeDropResolution {
  const zone = zoneForPointer(rect, clientY, isContainerRow(doc, rowId));
  return { zone, target: resolveTreeDrop(doc, rowId, zone) };
}

/**
 * Converts a resolved tree index (a position in the container's CURRENT
 * children) into the after-removal index moveComponent expects (contract §5):
 * when the moved id currently sits in the same container ABOVE the target
 * position, its removal shifts everything after it up by one. Cross-container
 * moves and same-container moves below the target pass through unchanged.
 */
export function moveIndexFor(doc: SurfaceDoc, movedId: string, target: TreeDropTarget): number {
  const container = doc.components.find((c) => c.id === target.containerId);
  const children = Array.isArray(container?.children) ? container.children : [];
  const current = children.indexOf(movedId);
  return current >= 0 && current < target.index ? target.index - 1 : target.index;
}
