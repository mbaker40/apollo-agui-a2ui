import type { SurfaceDoc } from './surface-doc';
import { CATALOG_ID, ROOT_ID, SURFACE_ID } from './surface-doc';

/**
 * Seed layout shown on first load so the canvas is never blank.
 * "Clear canvas" empties back to the bare root Column, not to this.
 */
export function welcomeDoc(): SurfaceDoc {
  return {
    surfaceId: SURFACE_ID,
    catalogId: CATALOG_ID,
    components: [
      {
        id: ROOT_ID,
        component: 'Column',
        children: ['welcome-card'],
        justify: 'start',
        align: 'stretch',
      },
      { id: 'welcome-card', component: 'Card', child: 'welcome-body' },
      {
        id: 'welcome-body',
        component: 'Column',
        children: ['welcome-title', 'welcome-text', 'welcome-cta'],
      },
      { id: 'welcome-title', component: 'Text', text: 'A2UI Composer', usageHint: 'h2' },
      {
        id: 'welcome-text',
        component: 'Text',
        text: 'Drag components from the glossary onto the canvas, edit the layout JSON in the drawer, or ask the chat to build something.',
      },
      {
        id: 'welcome-cta',
        component: 'Button',
        child: 'welcome-cta-label',
        primary: true,
        action: { event: { name: 'get-started', context: [] } },
      },
      { id: 'welcome-cta-label', component: 'Text', text: 'Get started' },
    ],
    dataModel: {},
  };
}
