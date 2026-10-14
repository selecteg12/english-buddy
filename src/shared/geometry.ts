export interface Rect { x: number; y: number; width: number; height: number }
export function clampRect(rect: Rect, area: Rect): Rect {
  const width = Math.min(rect.width, area.width), height = Math.min(rect.height, area.height);
  return { width, height, x: Math.round(Math.max(area.x, Math.min(rect.x, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(rect.y, area.y + area.height - height))) };
}
export function popupBounds(flag: Rect, area: Rect): Rect {
  const width = Math.min(390, area.width), height = Math.min(420, area.height);
  const above = flag.y - height - 8;
  const y = above >= area.y ? above : flag.y + flag.height + 8;
  return clampRect({ x: flag.x + flag.width / 2 - width / 2, y, width, height }, area);
}
