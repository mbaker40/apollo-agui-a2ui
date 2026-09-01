/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Adapted from a2ui-project/composer
 * samples/react-basic-catalog/src/main.spec.tsx (commit 40463c8): same
 * window.parent stubbing pattern; adds coverage for the data-a2ui-id wrapper
 * tagging and the COMPOSERX sidecar protocol.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PreviewBridgeMessageType } from 'a2ui-bridge/messages';
import { App } from '../src/App';
import {
  COMPOSERX_DND_END,
  COMPOSERX_DND_HOVER,
  COMPOSERX_DND_TARGET,
  COMPOSERX_PROP_SPECS,
  COMPOSERX_SIDECAR_READY,
  destroyComposerxSidecar,
  initComposerxSidecar,
} from '../src/sidecar';

const RENDER_PAYLOAD = [
  {
    version: 'v0.9',
    createSurface: {
      surfaceId: 'composer-canvas',
      catalogId: 'https://a2ui.org/specification/v0_9/basic_catalog.json',
    },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'composer-canvas',
      components: [
        { id: 'root', component: 'Column', children: ['text-1', 'button-1'] },
        { id: 'text-1', component: 'Text', text: 'Welcome React User' },
        {
          id: 'button-1',
          component: 'Button',
          child: 'button-label',
          action: { event: { name: 'TICKET_SUBMIT', context: {} } },
        },
        { id: 'button-label', component: 'Text', text: 'Submit Ticket' },
      ],
    },
  },
];

describe('ComposerX catalog app', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let originalParent: Window;

  beforeEach(() => {
    originalParent = window.parent;
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: vi.fn() },
    });
    initComposerxSidecar();
    container = document.createElement('div');
    container.id = 'app-root';
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
    destroyComposerxSidecar();
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: originalParent,
    });
    vi.restoreAllMocks();
  });

  async function mountApp() {
    await act(async () => {
      if (container) {
        root = createRoot(container);
        root.render(<App />);
      }
    });
  }

  async function postFromHost(data: unknown) {
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window.parent,
          origin: window.location.origin,
          data,
        }),
      );
    });
    // Let the bridge's deferred two-step createSurface dispatch settle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('dispatches RENDERER_READY, then SIDECAR_READY v3, then PROP_SPECS on mount', async () => {
    const postSpy = vi.spyOn(window.parent, 'postMessage');
    await mountApp();

    const types = postSpy.mock.calls.map((call) => (call[0] as { type: string }).type);
    const readyIndex = types.indexOf(PreviewBridgeMessageType.RENDERER_READY);
    const sidecarIndex = types.indexOf(COMPOSERX_SIDECAR_READY);
    expect(readyIndex).toBeGreaterThanOrEqual(0);
    expect(sidecarIndex).toBeGreaterThan(readyIndex);
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COMPOSERX_SIDECAR_READY,
        payload: { features: ['dnd-hittest', 'select', 'prop-specs', 'move'], version: 3 },
      }),
      window.location.origin,
    );

    // Prop specs immediately follow the announcement (contract section 4d).
    expect(types[sidecarIndex + 1]).toBe(COMPOSERX_PROP_SPECS);
    const specsCall = postSpy.mock.calls[sidecarIndex + 1]?.[0] as {
      payload: { components: Record<string, { props: unknown[] }> };
    };
    expect(specsCall.payload.components).toBeDefined();
    expect(Object.keys(specsCall.payload.components)).toHaveLength(18);
    expect(specsCall.payload.components['Button']?.props.length).toBeGreaterThan(0);
  });

  it('renders the waiting placeholder before payloads arrive', async () => {
    await mountApp();
    expect(container?.innerHTML).toContain('Waiting for RENDER_A2UI payloads...');
  });

  it('renders a RENDER_A2UI tree with data-a2ui-id wrappers stamped', async () => {
    await mountApp();
    await postFromHost({ type: PreviewBridgeMessageType.RENDER_A2UI, payload: RENDER_PAYLOAD });

    expect(container?.innerHTML).toContain('Welcome React User');
    expect(container?.innerHTML).toContain('Submit Ticket');
    expect(container?.querySelector('button')).not.toBeNull();

    for (const id of ['root', 'text-1', 'button-1', 'button-label']) {
      const wrapper = container?.querySelector(`[data-a2ui-id="${id}"]`);
      expect(wrapper, `wrapper for ${id}`).not.toBeNull();
      expect((wrapper as HTMLElement).style.display).toBe('contents');
    }
    expect(
      container?.querySelector('[data-a2ui-id="button-1"]')?.getAttribute('data-a2ui-component'),
    ).toBe('Button');
    // The wrapper's direct child is the real element (layout-safe tagging).
    expect(container?.querySelector('[data-a2ui-id="button-1"] > button')).not.toBeNull();
  });

  it('pipes component actions up as SEND_TO_SERVER', async () => {
    const postSpy = vi.spyOn(window.parent, 'postMessage');
    await mountApp();
    await postFromHost({ type: PreviewBridgeMessageType.RENDER_A2UI, payload: RENDER_PAYLOAD });

    const btn = container?.querySelector('button') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    await act(async () => {
      btn.click();
    });

    expect(postSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: PreviewBridgeMessageType.SEND_TO_SERVER,
        payload: expect.objectContaining({
          action: expect.objectContaining({
            name: 'TICKET_SUBMIT',
            sourceComponentId: 'button-1',
          }),
        }),
      }),
      window.location.origin,
    );
  });

  it('answers COMPOSERX_DND_HOVER with a drop target and clears on END', async () => {
    const postSpy = vi.spyOn(window.parent, 'postMessage');
    await mountApp();
    await postFromHost({ type: PreviewBridgeMessageType.RENDER_A2UI, payload: RENDER_PAYLOAD });

    await postFromHost({ type: COMPOSERX_DND_HOVER, payload: { x: 24, y: 24 } });

    const targetCall = postSpy.mock.calls.find(
      (call) => (call[0] as { type: string }).type === COMPOSERX_DND_TARGET,
    );
    expect(targetCall).toBeDefined();
    expect(targetCall?.[1]).toBe(window.location.origin);
    // jsdom has no layout, so the hit falls through to the root container.
    expect(targetCall?.[0]).toMatchObject({
      type: COMPOSERX_DND_TARGET,
      payload: expect.objectContaining({ containerId: 'root', slot: 'into' }),
    });

    expect(document.getElementById('composerx-drop-indicator-layer')?.childElementCount).toBe(1);
    await postFromHost({ type: COMPOSERX_DND_END });
    expect(document.getElementById('composerx-drop-indicator-layer')?.childElementCount).toBe(0);
  });

  it('ignores COMPOSERX messages from untrusted origins', async () => {
    const postSpy = vi.spyOn(window.parent, 'postMessage');
    await mountApp();
    await postFromHost({ type: PreviewBridgeMessageType.RENDER_A2UI, payload: RENDER_PAYLOAD });
    postSpy.mockClear();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window.parent,
          origin: 'https://evil.example',
          data: { type: COMPOSERX_DND_HOVER, payload: { x: 1, y: 1 } },
        }),
      );
    });

    const types = postSpy.mock.calls.map((call) => (call[0] as { type: string }).type);
    expect(types).not.toContain(COMPOSERX_DND_TARGET);
  });
});
