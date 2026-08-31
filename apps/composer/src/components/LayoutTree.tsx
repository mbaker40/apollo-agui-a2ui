import type { TreeNode } from '../lib/surface-doc';
import { componentTree } from '../lib/surface-doc';
import { useComposerState, useStore } from '../state/context';

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const store = useStore();
  const state = useComposerState();
  const selected = node.container && state.selectedContainerId === node.id;
  return (
    <>
      <div className="tree-row" style={{ paddingLeft: `${8 + depth * 14}px` }}>
        {node.container ? (
          <button
            className={`tree-node container ${selected ? 'selected' : ''}`}
            aria-pressed={selected}
            title={`Insert target: ${node.id}`}
            onClick={() => store.actions.selectContainer(node.id)}
          >
            <span className="tree-type">{node.component}</span>
            <span className="tree-id">#{node.id}</span>
          </button>
        ) : (
          <span className="tree-node leaf">
            <span className="tree-type">{node.component}</span>
            <span className="tree-id">#{node.id}</span>
          </span>
        )}
      </div>
      {node.children.map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

/** Nested component tree; container nodes select the structural insert target. */
export function LayoutTree() {
  const state = useComposerState();
  const root = componentTree(state.doc);
  return (
    <div className="layout-tree" aria-label="Layout tree">
      <TreeRow node={root} depth={0} />
    </div>
  );
}
