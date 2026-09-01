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
 * Adapted from a2ui-project/composer samples/react-basic-catalog/src/App.tsx
 * (commit 40463c8): renders the tagged brand catalog and announces the
 * COMPOSERX sidecar once the bridge handshake has fired.
 */

import { useEffect } from 'react';
import { useA2uiSandbox } from 'a2ui-bridge/react';
import { A2uiSurface } from '@a2ui/react/v0_9';
import { COMPONENT_USAGES } from './usages';
import { brandedBasicCatalog } from './branded-catalog';
import { announceComposerxSidecarReady } from './sidecar';

export function App() {
  const { surface } = useA2uiSandbox([brandedBasicCatalog], {
    getComponentUsages: async () => COMPONENT_USAGES,
  });

  // useA2uiSandbox's effect runs first (hook order), posting RENDERER_READY;
  // the sidecar announcement is guaranteed to follow it.
  useEffect(() => {
    announceComposerxSidecarReady();
  }, []);

  return (
    <main className="sandbox-shell">
      {surface ? (
        <A2uiSurface surface={surface} />
      ) : (
        <p className="sandbox-waiting">
          ComposerX catalog active. Waiting for RENDER_A2UI payloads...
        </p>
      )}
    </main>
  );
}
