/**
 * Hand-built, theme-aware mini-preview glyphs for the glossary tiles
 * (contract §7): pure CSS/inline-SVG drawings on the brand tokens — no
 * external assets. Unknown component names (BYO catalogs) fall back to a
 * generic component glyph so every catalog entry still renders a tile.
 */
import type { ReactElement } from 'react';

function Svg({ children, viewBox = '0 0 48 30' }: { children: ReactElement; viewBox?: string }) {
  return (
    <svg className="gp-svg" viewBox={viewBox} role="presentation" focusable="false">
      {children}
    </svg>
  );
}

const GLYPHS: Record<string, () => ReactElement> = {
  Text: () => (
    <div className="gp-stack">
      <span className="gp-bar gp-bar-heading" />
      <span className="gp-bar gp-bar-line" style={{ width: '92%' }} />
      <span className="gp-bar gp-bar-line" style={{ width: '70%' }} />
    </div>
  ),
  Image: () => (
    <Svg>
      <g>
        <rect x="4" y="2" width="40" height="26" rx="3" className="gp-stroke" />
        <circle cx="15" cy="10" r="3.2" className="gp-fill-accent" />
        <path d="M8 24 L19 13 L27 21 L33 15 L41 24 Z" className="gp-fill-soft" />
      </g>
    </Svg>
  ),
  Icon: () => (
    <Svg viewBox="0 0 24 24">
      <path
        d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5L2.6 9.3l6.5-.9z"
        className="gp-fill-accent"
      />
    </Svg>
  ),
  Video: () => (
    <div className="gp-screen">
      <span className="gp-play" />
    </div>
  ),
  AudioPlayer: () => (
    <div className="gp-audio">
      <span className="gp-play-disc">
        <span className="gp-play gp-play-sm" />
      </span>
      <span className="gp-wave">
        <i style={{ height: '40%' }} />
        <i style={{ height: '90%' }} />
        <i style={{ height: '60%' }} />
        <i style={{ height: '100%' }} />
        <i style={{ height: '50%' }} />
        <i style={{ height: '75%' }} />
      </span>
    </div>
  ),
  Row: () => (
    <div className="gp-row">
      <span className="gp-cell" />
      <span className="gp-cell" />
      <span className="gp-cell" />
    </div>
  ),
  Column: () => (
    <div className="gp-column">
      <span className="gp-cell gp-cell-wide" />
      <span className="gp-cell gp-cell-wide" />
      <span className="gp-cell gp-cell-wide" />
    </div>
  ),
  List: () => (
    <div className="gp-stack">
      {[0, 1, 2].map((i) => (
        <span key={i} className="gp-list-row">
          <i className="gp-dot" />
          <span className="gp-bar gp-bar-line" style={{ width: `${78 - i * 14}%` }} />
        </span>
      ))}
    </div>
  ),
  Card: () => (
    <div className="gp-card">
      <span className="gp-bar gp-bar-heading" style={{ width: '55%' }} />
      <span className="gp-bar gp-bar-line" style={{ width: '85%' }} />
    </div>
  ),
  Tabs: () => (
    <div className="gp-tabs">
      <div className="gp-tabstrip">
        <span className="gp-tab gp-tab-active" />
        <span className="gp-tab" />
        <span className="gp-tab" />
      </div>
      <span className="gp-bar gp-bar-line" style={{ width: '80%' }} />
    </div>
  ),
  Modal: () => (
    <div className="gp-backdrop">
      <div className="gp-dialog">
        <span className="gp-bar gp-bar-heading" style={{ width: '60%' }} />
        <span className="gp-bar gp-bar-line" style={{ width: '85%' }} />
      </div>
    </div>
  ),
  Divider: () => (
    <div className="gp-stack">
      <span className="gp-bar gp-bar-line" style={{ width: '80%', opacity: 0.4 }} />
      <span className="gp-rule" />
      <span className="gp-bar gp-bar-line" style={{ width: '80%', opacity: 0.4 }} />
    </div>
  ),
  Button: () => <span className="gp-pill">Action</span>,
  TextField: () => (
    <div className="gp-field">
      <span className="gp-caret" />
      <span className="gp-bar gp-bar-line" style={{ width: '55%' }} />
    </div>
  ),
  CheckBox: () => (
    <div className="gp-inline">
      <span className="gp-check">
        <Svg viewBox="0 0 12 12">
          <path
            d="M2.5 6.5l2.4 2.4 4.6-5.4"
            fill="none"
            className="gp-check-mark"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </span>
      <span className="gp-bar gp-bar-line" style={{ width: '46%' }} />
    </div>
  ),
  ChoicePicker: () => (
    <div className="gp-stack">
      <span className="gp-inline">
        <i className="gp-radio gp-radio-on" />
        <span className="gp-bar gp-bar-line" style={{ width: '50%' }} />
      </span>
      <span className="gp-inline">
        <i className="gp-radio" />
        <span className="gp-bar gp-bar-line" style={{ width: '38%' }} />
      </span>
    </div>
  ),
  Slider: () => (
    <div className="gp-slider">
      <span className="gp-track">
        <i className="gp-track-fill" />
      </span>
      <i className="gp-thumb" />
    </div>
  ),
  DateTimeInput: () => (
    <div className="gp-calendar">
      <span className="gp-cal-ring" style={{ left: '22%' }} />
      <span className="gp-cal-ring" style={{ right: '22%' }} />
      <div className="gp-cal-head" />
      <div className="gp-cal-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} className={i === 5 ? 'gp-cal-day gp-cal-today' : 'gp-cal-day'} />
        ))}
      </div>
    </div>
  ),
};

function GenericGlyph() {
  return (
    <div className="gp-generic">
      <Svg viewBox="0 0 24 24">
        <g>
          <path d="M8 5l-5 7 5 7" fill="none" className="gp-stroke-accent" strokeWidth="2" />
          <path d="M16 5l5 7-5 7" fill="none" className="gp-stroke-accent" strokeWidth="2" />
        </g>
      </Svg>
    </div>
  );
}

export function hasPreviewGlyph(name: string): boolean {
  return name in GLYPHS;
}

/** The tile's stylized mini-preview; also the drag ghost via setDragImage. */
export function GlossaryPreview({ name }: { name: string }) {
  const Glyph = GLYPHS[name];
  return (
    <span
      className={`gp ${Glyph ? `gp-${name.toLowerCase()}` : 'gp-fallback'}`}
      data-testid={`glossary-preview-${name}`}
      aria-hidden
    >
      {Glyph ? <Glyph /> : <GenericGlyph />}
    </span>
  );
}
