// Electron shows no menu on right-click by default; build the usual edit menu from what Chromium reports about the click.
export function contextMenuTemplate(params){
 const f=params.editFlags||{};
 if(params.isEditable)return [{role:'undo',enabled:f.canUndo},{role:'redo',enabled:f.canRedo},{type:'separator'},{role:'cut',enabled:f.canCut},{role:'copy',enabled:f.canCopy},{role:'paste',enabled:f.canPaste},{type:'separator'},{role:'selectAll',enabled:f.canSelectAll}];
 if(params.selectionText?.trim())return [{role:'copy',enabled:f.canCopy!==false},{type:'separator'},{role:'selectAll'}];
 return [];
}
