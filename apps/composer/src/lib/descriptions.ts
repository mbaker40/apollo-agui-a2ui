/** One-line glossary descriptions for the 18 basic-catalog components. */
const DESCRIPTIONS: Record<string, string> = {
  Text: 'Styled text — headings, body copy, captions.',
  Image: 'Image from a URL with fit control.',
  Icon: 'Material symbol glyph by name.',
  Video: 'Embedded video player for a media URL.',
  AudioPlayer: 'Audio playback with an optional description.',
  Row: 'Horizontal container; children left to right.',
  Column: 'Vertical container; children top to bottom.',
  List: 'Repeating list of child components.',
  Card: 'Elevated surface framing its content.',
  Tabs: 'Tabbed container switching between panes.',
  Modal: 'Dialog opened by a trigger component.',
  Divider: 'Thin rule separating content.',
  Button: 'Tappable button that fires an action event.',
  TextField: 'Text input bound to the data model.',
  CheckBox: 'Boolean toggle with a label.',
  ChoicePicker: 'Single or multiple choice from options.',
  Slider: 'Numeric picker along a range.',
  DateTimeInput: 'Date and/or time picker bound to data.',
};

export function describeComponent(name: string): string {
  return DESCRIPTIONS[name] ?? 'Catalog component';
}
