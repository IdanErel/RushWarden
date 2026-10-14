/**
 * Fixed hand slots (playtest U4): a card keeps its place, and its number key, for the whole
 * round. The run controller takes a played card out of the hand, so the hand's own order shifts
 * after every play; the screen shows the round's slots instead, with played cards left in place,
 * dimmed. Pure: the screen keeps the slots and calls `nextSlots` whenever the hand changes.
 */

/** One slot: the uid of the card shown there. */
export type Slots = readonly number[];

/**
 * The slots after a hand change. `prev` is the slots so far this round (empty at a round start),
 * `hand` the hand's uids in hand order and `played` the uids played this round. A slot keeps its
 * card while the card is in the hand or played; a slot whose card has gone (a redraw) takes the
 * next new card, so a redrawn hand refills the same places; any other new card goes on the end.
 */
export function nextSlots(prev: Slots, hand: readonly number[], played: readonly number[]): Slots {
  const inHand = new Set(hand);
  const kept = new Set(played);
  const fresh = hand.filter((u) => !prev.includes(u));
  const out: number[] = [];
  for (const u of prev) {
    if (inHand.has(u) || kept.has(u)) out.push(u);
    else if (fresh.length > 0) out.push(fresh.shift() as number);
  }
  out.push(...fresh);
  return out;
}

/** What one slot shows: a hand card (with its hand index for the run port) or a played card. */
export type SlotView =
  | { readonly kind: 'hand'; readonly uid: number; readonly handIndex: number }
  | { readonly kind: 'played'; readonly uid: number };

export function slotViews(
  slots: Slots,
  hand: readonly number[],
  played: readonly number[],
): SlotView[] {
  const out: SlotView[] = [];
  for (const uid of slots) {
    const handIndex = hand.indexOf(uid);
    if (handIndex >= 0) out.push({ kind: 'hand', uid, handIndex });
    else if (played.includes(uid)) out.push({ kind: 'played', uid });
  }
  return out;
}

/** Whether `slots` matches what `nextSlots` would give (so a render needs no state update). */
export function sameSlots(a: Slots, b: Slots): boolean {
  return a.length === b.length && a.every((u, i) => u === b[i]);
}
