import { useEffect, useRef, useState } from 'react';
import type { TreeNode } from '../lib/surface-doc';
import {
  ROOT_ID,
  canMoveGroupTo,
  canMoveTo,
  componentTree,
  partitionForMove,
} from '../lib/surface-doc';
import type { TreeDropZone } from '../lib/tree-drop';
import { dropTargetForPointer, groupMoveIndexFor, moveIndexFor } from '../lib/tree-drop';
import { useComposerState, useStore } from '../state/context';
import { DRAG_MIME } from './Glossary';

/** Drag data type for moving a placed component (contract §7): value = its id. */
export const MOVE_MIME = 'application/x-composerx-move';

interface DropIndicator {
  rowId: string;
  zone: TreeDropZone;
  valid: boolean;
}

interface TreeDnd {
  indicator: DropIndicator | null;
  onRowDragStart(node: TreeNode, e: React.DragEvent<HTMLElement>): void;
  onRowDragEnd(): void;
  onRowDragOver(node: TreeNode, e: React.DragEvent<HTMLElement>): void;
  onRowDrop(node: TreeNode, e: React.DragEvent<HTMLElement>): void;
}

function TreeRow({ node, depth, dnd }: { node: TreeNode; depth: number; dnd: TreeDnd }) {
  const store = useStore();
  const state = useComposerState();
  // Multi-select (contract §4f): every row IN the selection list highlights;
  // the primary (first id) reads stronger via the extra `primary` class.
  const selected = state.selectedComponentIds.includes(node.id);
  const primary = state.selectedComponentId === node.id;
  // Tree follows the selection (contract §7 ancestor honing): whenever this
  // node BECOMES the primary selection — canvas tap, repeat-tap cycling
  // step, breadcrumb, ↑ parent button — scroll it into view so the
  // hierarchy is one glance away. Only the primary scrolls (scrolling every
  // toggled row would make the tree jump around while building a
  // multi-selection). block:'nearest' + no smooth behavior keeps it cheap
  // and deterministic; jsdom has no scrollIntoView, hence the typeof guard.
  const nodeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = nodeRef.current;
    if (primary && el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [primary]);
  const indicator = dnd.indicator?.rowId === node.id ? dnd.indicator : null;
  const showLineBefore = indicator?.valid === true && indicator.zone === 'before';
  const showLineAfter = indicator?.valid === true && indicator.zone === 'after';
  const dropInto = indicator?.valid === true && indicator.zone === 'into';
  const noDrop = indicator?.valid === false;
  const indent = `${8 + depth * 14}px`;
  const line = (
    <div
      className="tree-drop-indicator"
      data-testid="tree-drop-indicator"
      style={{ marginLeft: indent }}
      aria-hidden
    />
  );
  return (
    <>
      {showLineBefore && line}
      <div
        className={`tree-row ${noDrop ? 'no-drop' : ''}`}
        data-testid={`tree-row-${node.id}`}
        style={{ paddingLeft: indent }}
        onDragOver={(e) => dnd.onRowDragOver(node, e)}
        onDrop={(e) => dnd.onRowDrop(node, e)}
      >
        <button
          ref={nodeRef}
          className={`tree-node ${node.container ? 'container' : 'leaf'} ${
            selected ? 'selected' : ''
          } ${primary ? 'primary' : ''} ${dropInto ? 'drop-into' : ''}`}
          data-testid={`tree-node-${node.id}`}
          aria-pressed={selected}
          draggable={node.id !== ROOT_ID}
          title={
            node.container
              ? `Select ${node.component} #${node.id} (children-array container — inserts land here; shift-click toggles)`
              : `Select ${node.component} #${node.id} (shift-click toggles)`
          }
          onClick={(e) => {
            // Contract §4f: shift-click toggles the row in/out of the
            // multi-selection; a plain click stays a replace select.
            if (e.shiftKey) store.actions.toggleSelected(node.id);
            else store.actions.selectComponent(node.id);
          }}
          onDragStart={(e) => dnd.onRowDragStart(node, e)}
          onDragEnd={() => dnd.onRowDragEnd()}
        >
          <span className="tree-type">{node.component}</span>
          <span className="tree-id">#{node.id}</span>
        </button>
      </div>
      {showLineAfter && line}
      {node.children.map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} dnd={dnd} />
      ))}
    </>
  );
}

/**
 * Nested component tree sharing the unified selection: every node is
 * clickable/selectable (containers stay visually distinguished); inserts go
 * to the container derived from the selection (insertTargetFor).
 *
 * Drag-to-rearrange (contract §7, works with ANY renderer): every non-root
 * row is an HTML5 drag source (MOVE_MIME = its id), and every row accepts
 * both move drags and glossary tile drags. Hovering resolves by thirds of the
 * row rect (upper → before it in its parent, lower → after, middle → into
 * children-array container rows; leaf middles split by half). Validity comes
 * from canMoveTo — invalid targets render no-drop and refuse the drop. Drops
 * apply moveComponentTo (after-removal index via moveIndexFor) or a
 * positioned insertComponent; each applied drop is one undo step.
 *
 * Group drag (contract §4e/§4f): dragging a row that is a MEMBER of the
 * multi-selection lifts the whole selection — validity comes from
 * canMoveGroupTo, the pre-removal index is adjusted for EVERY moved id above
 * the target in the same container (groupMoveIndexFor), and the drop applies
 * moveComponentsTo (one undo step, skipped members toasted). Dragging a
 * non-member collapses the selection to that row and single-moves it.
 */
export function LayoutTree() {
  const store = useStore();
  const state = useComposerState();
  const root = componentTree(state.doc);
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);
  // The dragged row id, readable during dragover (HTML5 DnD hides getData
  // until drop). Cross-window move drags have the type but no local id and
  // therefore never validate.
  const draggedIdRef = useRef<string | null>(null);
  // Group drag (§4e/§4f): when the dragged row is a MEMBER of the current
  // multi-selection, the whole selection lifts — this holds it, captured at
  // dragstart so mid-drag selection races cannot change what is moving.
  // null = single-row drag.
  const draggedIdsRef = useRef<string[] | null>(null);

  const clearDrag = () => {
    draggedIdRef.current = null;
    draggedIdsRef.current = null;
    setIndicator(null);
  };

  const dnd: TreeDnd = {
    indicator,
    onRowDragStart(node, e) {
      e.dataTransfer.setData(MOVE_MIME, node.id);
      e.dataTransfer.effectAllowed = 'move';
      draggedIdRef.current = node.id;
      const selection = store.getState().selectedComponentIds;
      if (selection.length >= 2 && selection.includes(node.id)) {
        // §4e group move: dragging a MEMBER of the multi-selection lifts the
        // whole selection — it stays exactly the group (no collapse).
        draggedIdsRef.current = [...selection];
        return;
      }
      draggedIdsRef.current = null;
      // Mirror the canvas move (§4e): lifting a component selects it —
      // and, per §4f, a tree drag started on a NON-member of a
      // multi-selection COLLAPSES it to the dragged row (selectComponent
      // replaces the list).
      store.actions.selectComponent(node.id);
    },
    onRowDragEnd() {
      clearDrag();
    },
    onRowDragOver(node, e) {
      if (!e.dataTransfer) return;
      const types = Array.from(e.dataTransfer.types ?? []);
      const isMove = types.includes(MOVE_MIME);
      const isInsert = types.includes(DRAG_MIME);
      if (!isMove && !isInsert) return;
      const doc = store.getState().doc;
      const { zone, target } = dropTargetForPointer(
        doc,
        node.id,
        e.currentTarget.getBoundingClientRect(),
        e.clientY,
      );
      let valid = target !== null;
      if (valid && isMove && target) {
        const movedId = draggedIdRef.current;
        const group = draggedIdsRef.current;
        valid =
          group !== null
            ? canMoveGroupTo(doc, group, target.containerId).ok
            : movedId !== null && canMoveTo(doc, movedId, target.containerId).ok;
      }
      if (valid) {
        e.preventDefault(); // accept the drop
        e.dataTransfer.dropEffect = isMove ? 'move' : 'copy';
      } else {
        e.dataTransfer.dropEffect = 'none'; // not-allowed cursor, drop refused
      }
      setIndicator((prev) =>
        prev && prev.rowId === node.id && prev.zone === zone && prev.valid === valid
          ? prev
          : { rowId: node.id, zone, valid },
      );
    },
    onRowDrop(node, e) {
      e.preventDefault();
      const doc = store.getState().doc;
      const { target } = dropTargetForPointer(
        doc,
        node.id,
        e.currentTarget.getBoundingClientRect(),
        e.clientY,
      );
      const group = draggedIdsRef.current;
      clearDrag();
      if (!target) return;
      const movedId = e.dataTransfer.getData(MOVE_MIME);
      if (movedId) {
        if (group !== null && group.includes(movedId)) {
          // Group drop (§4e): the tree resolves a PRE-removal index, so
          // subtract every id the group move will actually splice out of the
          // target container above that position (§5 after-all-removals
          // semantics). moveComponentsTo is the same one-undo + skip-toast
          // action the canvas MOVE_DROP-with-ids path applies.
          const movable = partitionForMove(doc, group).movable;
          store.actions.moveComponentsTo(
            group,
            target.containerId,
            groupMoveIndexFor(doc, movable, target),
          );
          return;
        }
        // Tree indices are positions in the CURRENT children array; convert
        // to the after-removal index moveComponent expects (§5).
        store.actions.moveComponentTo(
          movedId,
          target.containerId,
          moveIndexFor(doc, movedId, target),
        );
        return;
      }
      const name = e.dataTransfer.getData(DRAG_MIME);
      if (name) {
        // Glossary tile dropped on a tree row: positioned insert (§7).
        store.actions.insertComponent(name, {
          containerId: target.containerId,
          index: target.index,
        });
        store.actions.setDragging(false);
      }
    },
  };

  return (
    <div
      className="layout-tree"
      aria-label="Layout tree"
      onDragLeave={(e) => {
        // Leaving the tree region clears the indicators; row-to-row churn is
        // filtered out via relatedTarget (still inside the tree).
        const related = e.relatedTarget as Node | null;
        if (related && e.currentTarget.contains(related)) return;
        setIndicator(null);
      }}
    >
      <TreeRow node={root} depth={0} dnd={dnd} />
    </div>
  );
}
