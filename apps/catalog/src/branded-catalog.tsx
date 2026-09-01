import { basicCatalog } from '@a2ui/react/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import { Catalog } from '@a2ui/web_core/v0_9';
import type { ComponentContext, FunctionImplementation } from '@a2ui/web_core/v0_9';
import type { FC, ReactNode } from 'react';

interface RenderProps {
  context: ComponentContext;
  buildChild: (id: string, basePath?: string) => ReactNode;
}

/**
 * `@a2ui/react` stamps no id into the DOM, but every component render receives
 * its `ComponentContext` (with `componentModel.id`/`.type`). We wrap each
 * catalog implementation so the rendered output is tagged with
 * `data-a2ui-id` / `data-a2ui-component` on a `display: contents` span.
 * `display: contents` generates no box, so Row/Column/List flex layout is
 * untouched; the DnD sidecar hit-tests via
 * `elementFromPoint(...).closest('[data-a2ui-id]')` and measures rects from
 * the wrapper's descendants (see src/sidecar.ts).
 */
function withComponentTag(impl: ReactComponentImplementation): ReactComponentImplementation {
  const Original = impl.render;
  const Tagged: FC<RenderProps> = ({ context, buildChild }) => (
    <span
      style={{ display: 'contents' }}
      data-a2ui-id={context.componentModel.id}
      data-a2ui-component={context.componentModel.type}
    >
      <Original context={context} buildChild={buildChild} />
    </span>
  );
  Tagged.displayName = `ComposerxTagged(${impl.name})`;
  return { ...impl, render: Tagged };
}

/**
 * The stock basic catalog with every component wrapped. Protocol-identical to
 * `basicCatalog`: the catalog is looked up by `id`, which the bridge re-stamps
 * from `createSurface.catalogId` (`onCatalogResolved`) before processing.
 */
export const brandedBasicCatalog: Catalog<ReactComponentImplementation> = new Catalog(
  basicCatalog.id,
  [...basicCatalog.components.values()].map(withComponentTag),
  [...basicCatalog.functions.values()] as FunctionImplementation[],
  basicCatalog.themeSchema,
);
