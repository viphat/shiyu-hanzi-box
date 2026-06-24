# Single-Card Review Experience Design

## Summary

Replace the Review tab's vertical list of small cards with one large review
card at a time. The review queue remains controlled by the existing FSRS domain
logic: the UI renders the first filtered due item, and rating or postponing that
item causes the recalculated queue's next item to appear.

Word and quote entries use different reveal behavior:

- A word displays the saved word immediately, but hides pinyin, dictionary
  definitions, notes, source examples, pronunciation, and AI insight until the
  user clicks **Reveal / 查看答案**.
- A quote displays its text, note, category, and source immediately. It has no
  reveal step because the saved quote itself is the content being reviewed.

The transition between cards is a quick fade and horizontal slide, not a
literal card-flip animation.

## Goals

- Make the Review tab feel focused rather than like another inbox list.
- Show only one due card at a time.
- Make the active review card materially larger and easier to read.
- Preserve active recall for words without pretending quotes have a separate
  front and back.
- Keep FSRS queue ordering and scheduling as the source of truth.
- Advance automatically after Again, Hard, Good, Easy, or Postpone.

## Non-Goals

- Do not add manual previous/next navigation.
- Do not create a separate persisted review-session queue.
- Do not change FSRS scheduling, daily new-card limits, search filtering, or
  postpone semantics.
- Do not add a 3D flip animation.
- Do not change the normal Words and Quotes tab cards.

## Queue And Session Behavior

`App.tsx` continues to build and search-filter the due queue. `ReviewQueue`
renders only `items[0]`.

The queue itself is the session state:

1. The first filtered due item is displayed.
2. The user rates or postpones it.
3. The existing storage mutation updates that entry.
4. `buildSrsQueue` recalculates the queue.
5. The new `items[0]` becomes the displayed card.

No local index is persisted or incremented. This avoids drift when FSRS puts an
Again card back into the queue, a sub-day card becomes due, search changes, or
another storage update changes queue membership.

The card header shows progress as a remaining count, such as **12 remaining /
剩余 12 张**. This is more accurate than `1 / N`, because Again may return a card
later and the queue size can change during a session.

## Word Review Card

The unrevealed word card contains:

- word/status badges and source metadata;
- the saved Simplified Chinese word as the dominant central content;
- a single **Reveal / 查看答案** action;
- Postpone as a visually secondary action.

Before reveal, the card does not render:

- pinyin or tone chips;
- dictionary definitions;
- pronunciation;
- the user's note;
- source examples;
- AI insight;
- Again, Hard, Good, or Easy controls.

After reveal, the existing `ReviewInsightReveal` content is shown inside the
same large card and the four rating controls become available. Postpone remains
available.

## Quote Review Card

The quote card immediately renders:

- quote/status/category/source badges;
- the complete quote text in a large blockquote;
- the saved note when present;
- source title or domain;
- Again, Hard, Good, Easy, and Postpone controls.

It does not render Reveal or “Show answer” language. A quote has no hidden
answer side in the current data model.

## Layout

The Review tab uses one centered card with a `420px` minimum height, generous
padding, and a wider reading measure than the existing list cards.

Suggested desktop structure:

1. metadata and remaining count at the top;
2. primary word or quote content in the central area;
3. revealed insight or quote details below the primary content;
4. actions anchored near the bottom.

On narrow screens, the card remains full width, padding reduces modestly, and
rating controls wrap without horizontal overflow.

The empty-state card remains when no filtered due entries exist.

## Transition

When the user rates or postpones:

1. Disable all actions to prevent duplicate answers.
2. Apply an exit state for roughly `140–180ms`: slight left translation and
   opacity fade.
3. Invoke the existing answer/postpone callback.
4. When the active item identity changes, render it with a slight right offset
   and fade/slide it into place over roughly `140–180ms`.

The transition respects `prefers-reduced-motion` by removing translation and
using either no animation or a minimal opacity change.

If a storage mutation does not change the active item, the card returns to its
interactive state rather than remaining disabled.

## Component Boundaries

### `ReviewQueue`

- Accepts the existing queue and callbacks.
- Selects the first item only.
- Owns transition/busy state.
- Displays the remaining count.
- Resets reveal state when the active entry identity changes.

### `ReviewCard`

- Renders the larger shared shell.
- Branches explicitly between word and quote behavior.
- Keeps word reveal state local to the active card.
- Exposes rating and postpone controls according to entry kind and reveal state.

### `ReviewInsightReveal`

- Continues to render the existing word insight.
- Is mounted already revealed by the review card after the main word reveal.
- Is never used for quote cards.

### `App`

- Continues to own FSRS mutations and queue construction.
- Does not track a separate current-card index.

## Accessibility

- Keep all controls as semantic buttons with localized labels and titles.
- Mark the busy card with `aria-busy`.
- Disable controls during the exit/update transition.
- Move focus to the new card heading after advancement when practical, without
  stealing focus on initial page load.
- Do not rely on animation alone to communicate advancement.

## Localization

Retain Reveal labels for word cards only. Add localized labels for:

- remaining-card count.

Remove or stop rendering quote-specific “Show answer” copy. Existing rating
labels remain unchanged.

## Testing

Component tests should verify:

- only the first queue item is rendered;
- the remaining count reflects the queue length;
- a word initially shows its text and Reveal but hides insight and ratings;
- a revealed word shows insight and all rating controls;
- a quote immediately shows its text and note with rating controls;
- a quote never shows Reveal or “Show answer”;
- active-card identity changes reset word reveal state;
- actions are disabled during transition;
- the transition callback advances through the existing answer/postpone path.

Run focused component/i18n tests, then `npm run compile` and `npm test`.

## Documentation Follow-Up

After the UI change is implemented, update README, AGENTS.md, and Chrome Web
Store documentation to describe spaced repetition quietly as a supporting
feature. Store-facing copy should use plain “spaced repetition” rather than
headline-level FSRS branding.
