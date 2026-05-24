const assert = require('assert');
const fs = require('fs');

const css = fs.readFileSync('style.css', 'utf8');
const normalizedCss = css.replace(/\r\n/g, '\n');

function blockFor(selector) {
  const start = normalizedCss.indexOf(`${selector} {`);
  assert(start >= 0, `missing CSS block for ${selector}`);
  const end = normalizedCss.indexOf('}', start);
  assert(end > start, `unterminated CSS block for ${selector}`);
  return normalizedCss.slice(start, end + 1);
}

assert(css.includes('--max-width: 1280px;'), 'main page width should stay at 1280px');

const tableWrap = blockFor('#panel-nal .table-wrap');
assert(tableWrap.includes('height: var(--nal-table-height);'), 'NAL list should use the shared table height');
assert(tableWrap.includes('overflow-y: scroll;'), 'NAL list should reserve a vertical scrollbar');
assert(tableWrap.includes('overflow-x: auto;'), 'NAL list should allow horizontal scrolling');
assert(tableWrap.includes('scrollbar-gutter: stable;'), 'NAL list should reserve scrollbar gutter');

const nalPanel = blockFor('#panel-nal.active');
assert(nalPanel.includes('--nal-toolbar-height: 38px;'), 'NAL panel should use a stable toolbar row height');
assert(nalPanel.includes('--nal-row-gap: 16px;'), 'NAL panel should use a shared vertical gap');
assert(nalPanel.includes('--nal-table-height: min(68vh, 680px);'), 'NAL panel should define the shared table height');
assert(nalPanel.includes('--inspector-header-height: 56px;'), 'inspector headers should have a stable height');
assert(nalPanel.includes('--field-list-height: 320px;'), 'field inspector table should have a stable height');
assert(nalPanel.includes('grid-template-rows: var(--nal-toolbar-height) minmax(0, var(--nal-table-height));'), 'NAL panel should give the table row a stable height');
assert(nalPanel.includes('"toolbar inspector"'), 'NAL inspector should keep its original top alignment with the toolbar row');
assert(nalPanel.includes('"table inspector"'), 'NAL inspector should extend through the table row');
assert(nalPanel.includes('gap: var(--nal-row-gap) 16px;'), 'NAL grid should use the shared vertical gap');
assert(nalPanel.includes('align-items: stretch;'), 'NAL grid items should stretch so table bottoms can align');

const nalInspector = blockFor('#panel-nal .nal-inspector');
assert(nalInspector.includes('height: calc(var(--nal-toolbar-height) + var(--nal-row-gap) + var(--nal-table-height));'), 'NAL inspector should end at the same y-position as the NAL list table bottom');
assert(nalInspector.includes('position: sticky;'), 'NAL inspector should retain its original desktop top behavior');
assert(nalInspector.includes('top: 12px;'), 'NAL inspector should retain its original sticky offset');

const panelToolbar = blockFor('#panel-nal .panel-toolbar');
assert(panelToolbar.includes('height: var(--nal-toolbar-height);'), 'NAL toolbar should match the explicit grid row height');
assert(panelToolbar.includes('margin-bottom: 0;'), 'NAL toolbar should not add extra bottom space beyond the grid gap');

const inspectorBinary = blockFor('.inspector-binary');
assert(inspectorBinary.includes('flex: 1 1 auto;'), 'binary inspector section should fill remaining inspector height');
assert(inspectorBinary.includes('min-height: 0;'), 'binary inspector section should be allowed to shrink inside fixed inspector height');
assert(inspectorBinary.includes('display: flex;'), 'binary inspector section should manage its internal scroll area');
assert(inspectorBinary.includes('flex-direction: column;'), 'binary inspector section should stack header and scroll area');

const inspectorFields = blockFor('.inspector-fields');
assert(inspectorFields.includes('flex: 0 0 calc(var(--inspector-header-height) + var(--field-list-height));'), 'field inspector section should keep a stable outer height across NAL selections');
assert(inspectorFields.includes('display: flex;'), 'field inspector section should manage its scroll area');
assert(inspectorFields.includes('flex-direction: column;'), 'field inspector section should stack header and field table');

const inspectorHeader = blockFor('.inspector-header,\n.binary-header');
assert(inspectorHeader.includes('height: var(--inspector-header-height);'), 'inspector headers should not resize when selected NAL text changes');
assert(inspectorHeader.includes('flex: 0 0 var(--inspector-header-height);'), 'inspector headers should keep fixed flex height');

const nalTable = blockFor('#nal-table');
assert(nalTable.includes('min-width: 900px;'), 'NAL table should keep enough width to scroll horizontally');

assert(!normalizedCss.includes('#nal-table th:nth-child(10)'), 'NAL table should not keep a hidden codec column before TID');

const temporalColumn = blockFor('#nal-table th:nth-child(9),\n#nal-table td:nth-child(9)');
assert(temporalColumn.includes('width: 34px;'), 'Temporal ID column should stay compact');
assert(temporalColumn.includes('text-align: center;'), 'Temporal ID values should stay centered');

const tidColumn = blockFor('#nal-table th.tid-col,\n#nal-table td.tid-col');
assert(tidColumn.includes('width: 34px;'), 'TID header and values should share the same narrow class width');
assert(tidColumn.includes('min-width: 34px;'), 'TID column should not expand beyond its intended width');
assert(tidColumn.includes('max-width: 34px;'), 'TID column should not expand beyond its intended width');
assert(tidColumn.includes('padding-inline: 3px;'), 'TID column should override generic NAL cell padding');
assert(tidColumn.includes('text-align: center;'), 'TID header and values should align consistently');

const tidHeader = blockFor('#nal-table th.tid-col');
assert(!tidHeader.includes('font-size: 0.66rem;'), 'TID header should not be visually smaller than other compact headers');
assert(tidHeader.includes('letter-spacing: 0;'), 'TID header should not inherit wide table header letter spacing');

const nameColumn = blockFor('#nal-table th:nth-child(3),\n#nal-table td:nth-child(3)');
assert(nameColumn.includes('width: 180px;'), 'NAL name column should stay compact when long names are shown');
assert(nameColumn.includes('white-space: nowrap;'), 'NAL name column should keep long names on one line');
assert(nameColumn.includes('text-overflow: ellipsis;'), 'NAL name column should truncate long names visually');

const fieldList = blockFor('.field-list');
assert(fieldList.includes('height: auto;'), 'field list should use the fixed field section height');
assert(fieldList.includes('flex: 1 1 auto;'), 'field list should fill the fixed field section');
assert(fieldList.includes('min-height: 0;'), 'field list should scroll instead of changing section height');
assert(fieldList.includes('overflow-y: scroll;'), 'field list should reserve a vertical scrollbar');
assert(fieldList.includes('scrollbar-gutter: stable;'), 'field list should reserve scrollbar gutter');

const fieldTree = blockFor('.field-tree');
assert(fieldTree.includes('display: flex;'), 'Selected NAL tree should stack nodes predictably');
assert(fieldTree.includes('gap:'), 'Selected NAL tree should keep compact spacing between nodes');

const fieldTreeNode = blockFor('.field-tree-node');
assert(fieldTreeNode.includes('border:'), 'collapsible tree nodes should have a visible grouping boundary');

const fieldTreeToggle = blockFor('.field-tree-toggle');
assert(fieldTreeToggle.includes('cursor: pointer;'), 'tree node summaries should advertise collapse interaction');
assert(fieldTreeToggle.includes('display: grid;'), 'tree node summaries should align label/value/count columns');

const clickableFieldTreeToggle = blockFor('.field-tree-toggle.field-clickable');
assert(clickableFieldTreeToggle.includes('box-shadow:'), 'clickable tree group nodes should be visually distinct from static groups');

const fieldTreeChildren = blockFor('.field-tree-children');
assert(fieldTreeChildren.includes('border-left:'), 'nested tree children should show hierarchy');

const clickableField = blockFor('button.field-row.field-clickable');
assert(clickableField.includes('cursor: pointer;'), 'clickable fields should advertise pointer interaction');
assert(clickableField.includes('background:'), 'clickable fields should have distinct visual treatment');

const staticField = blockFor('.field-row.field-static');
assert(staticField.includes('opacity:'), 'static fields should be visually quieter than clickable fields');

const binaryView = blockFor('.binary-view');
assert(binaryView.includes('height: auto;'), 'binary view should flex to align inspector bottom with NAL list');
assert(binaryView.includes('flex: 1 1 auto;'), 'binary view should fill remaining binary inspector space');
assert(binaryView.includes('min-height: 0;'), 'binary view should scroll instead of forcing the inspector taller');
assert(binaryView.includes('overflow-y: scroll;'), 'binary view should reserve a vertical scrollbar');
assert(binaryView.includes('scrollbar-gutter: stable;'), 'binary view should reserve scrollbar gutter');

const idrPill = blockFor('.frame-pill.frame-idr');
assert(idrPill.includes('color:'), 'IDR frame pill should have distinct styling');

console.log('layout CSS assertions passed');
