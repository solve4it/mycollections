/**
 * The order after dragging `activeId` onto `overId`'s slot (#37): it takes that
 * place, and everything between moves one along — what a sortable list shows
 * while dragging, so the drop lands where it looked like it would. Null when
 * the drop changes nothing, so the caller sends no request.
 */
export function moveOnto(ids: readonly string[], activeId: string, overId: string | null): string[] | null {
  if (overId === null || activeId === overId) return null;
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}
