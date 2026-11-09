export function bindingItem(key:string) {
  if (key==="fill" || key==="fills" || key==="fills/0") return {list:"fills",index:0,field:"color"};
  if (key==="stroke") return {list:"strokes",index:0,field:"color"};
  const match=/^(fills|strokes|effects|layoutGrids)\/(\d+)\/(.+)$/s.exec(key);
  if (!match) return;
  const index=Number(match[2]);
  if (!Number.isSafeInteger(index)) return;
  return {list:match[1],index,field:match[3]};
}

export function canonicalBinding(key:string) {
  const item=bindingItem(key);
  return item ? item.list+"/"+item.index+"/"+item.field : key;
}
