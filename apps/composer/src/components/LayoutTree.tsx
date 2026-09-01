import type { TreeNode } from '../lib/surface-doc';
import { componentTree } from '../lib/surface-doc';
import { useComposerState, useStore } from '../state/context';

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const store = useStore();
  const state = useComposerState();
  const selected = state.selectedComponentId === node.id;
  return (
    <>
      <div className="tree-row" style={{ paddingLeft: `${8 + depth * 14}px` }}>
        <button
          className={`tree-node ${node.container ? 'container' : 'leaf'} ${
            selected ? 'selected' : ''
          }`}
          data-testid={`tree-node-${node.id}`}
          aria-pressed={selected}
          title={
            node.container
              ? `Select ${node.component} #${node.id} (children-array container — inserts land here)`
              : `Select ${node.component} #${node.id}`
          }
          onClick={() => store.actions.selectComponent(node.id)}
        >
          <span className="tree-type">{node.component}</span>
          <span className="tree-id">#{node.id}</span>
        </button>
      </div>
      {node.children.map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

/**
 * Nested component tree sharing the unified selection: every node is
 * clickable/selectable (containers stay visually distinguished); inserts go
 * to the container derived from the selection (insertTargetFor).
 */
export function LayoutTree() {
  const state = useComposerState();
  const root = componentTree(state.doc);
  return (
    <div className="layout-tree" aria-label="Layout tree">
      <TreeRow node={root} depth={0} />
    </div>
  );
}
