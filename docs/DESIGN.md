# TENtacle: design

Formerly Top Tens. Name the top 10 of a ranked list. Five lives.

## 1. Rules

- 10 hidden slots, ordered by rank. A correct guess reveals its slot (rank, name, source value).
- 5 lives. **Only an accepted answer outside the top 10 costs a life**, and the game shows where it ranks ("Austria is #113").
- Free (no life lost):
  - **Misspellings.** The input is corrected in place ("cambimia" becomes "Cambodia") and nothing is submitted until
    the player presses Enter again.
  - **Ambiguous typos** ("Irak"): tappable buttons fill the input with each option.
  - **Duplicates.**
  - **Anything that isn't an accepted answer** for the list: keyboard mash, or a real thing the source doesn't cover.
- The game ends at 10/10 or 0 lives; missed slots are then revealed. A give up button reveals everything.

## 2. Answer matching (`src/game/match.ts`)

1. Normalize: lowercase, strip accents and punctuation, `&` → `and`, drop a leading article, Roman numerals → digits.
2. Exact match on name or alias submits immediately.
3. Otherwise fuzzy match (edit distance with transpositions, budget scaled by length). A unique match fills the input.
   Ties offer choices.
4. Numbers must agree: GTA 6 never matches GTA V.
5. A guess that is itself a known real name (any name in the bank, any country or capital) is never corrected into a
   different one: "Austria" is not Australia.
6. Unmatched input is free; `junk.ts` only picks the message ("doesn't look like an answer" vs "not a recognized
   answer").

## 3. Content

Puzzles are prebuilt from Wikipedia tables (`scripts/topics.ts`, `scripts/build.ts`) into `public/puzzles/*.json`,
with every table row as an accepted answer, aliases from redirects, and a source link with an "as of" date.
Modes: daily (date-seeded pick) and roll (random unplayed, optional category filter).

## 4. Screens

1. **Home:** Today's list, Roll a random list, category chips, stats.
2. **Game:** prompt, lives, 10 rank slots, input pinned at the bottom, feedback line, chips for life-costing misses.
3. **Results:** score, full list with values, source link, share, roll another.
4. **How to play** on first visit.

## 5. Visual direction: Krillion's language, arcade high-score table

Krillion (krillion.cc) is the reference the owner likes. Borrow its visual language, not its ocean art: our
metaphor is a **retro arcade high-score table**, which a top 10 already is.

**From Krillion (observed):**
- Dark only. Page `#050a14` with a navy gradient (`#0d1e38` → `#020409`). Panels `#0d1830` / `#101d33`,
  glass `#08182e` at 85-95%. Hairlines `#7d93b8` at 22%.
- Text `#e8f1ff`, muted `#7d93b8`, labels `#8fa3c4`.
- Accents: cyan `#4de3ff` (primary), pink `#ff5d8f` (go buttons, wrong), gold `#ffd166` (suggestions, #1),
  red `#ff5252` (danger). No green anywhere.
- One font: **VT323** (Google Fonts), weight 400, pixel-crisp. Body 22px/1.35. Hierarchy from size, color,
  UPPERCASE and wide letter-spacing (0.25em buttons, 0.3em labels).
- Keycap buttons: 52px tall, radius 6, hard shadow `0 5px 0 #02060f` (pink key `0 5px 0 #a8365d`), press sinks 3px.
- Input 52px with a constant cyan glow ring. Cards: hard unblurred shadows, faint scanlines
  (`repeating-linear-gradient(0deg, #ffffff06 0 1px, transparent 1px 3px)`).
- Two-beat reveal: the world reacts first, then the verdict card fades and rises (0.35 s).
- Keyboard loop: autofocus, type, Enter. Inline confirm (QUIT → SURE?) instead of modals.
- Copy: short UPPERCASE labels, dry lowercase captions.
- Mobile: one column, controls wrap, nothing clipped.

**Ours:**
- The 10 slots are a high-score table: big pixel rank numerals (1ST, 2ND ...), names typed in like initials when found,
  #1 in gold. Missed slots revealed muted at the end.
- Lives as 5 pixel hearts or credit squares in the header; losing one flashes pink.
- Results: score in huge pixel type, the full table with values, share text with one square per rank and a link.
- Respect `prefers-reduced-motion`. Visible focus rings.

Screenshots of Krillion, taken by an earlier agent, are in
`/tmp/claude-0/-home-user/2375e5ee-46dc-5ea2-a7f4-fd0dd013e321/scratchpad/krillion/shots/` (start with
`d_009_p1_ready.png`, `d_030_p1_result.png`, `mu_008_p1_ready.png`, `d_126_summary_view.png`). Its stylesheet is in
`.../krillion/css/`.

## 6. TENtacle: the glow squid (direction from October 2026)

The game is now TENtacle, and it grows its own identity on top of the arcade table: **a squid has ten limbs (eight
arms, two long tentacles), and a top 10 has ten slots.** Every answer found is one limb lit.

- Look: an original pixel-art glow squid. Blocky, chunky pixels, a voxel/Minecraft-like vibe, bioluminescent glow in
  the existing palette (cyan glow, pink and gold accents on navy). Not a copy of any existing sprite.
- Feedback loop (owner-approved ideas):
  1. The squid fills in: one limb lights per answer found; ten lit is a full glowing squid.
  2. The tentacle grab: a correct answer is snatched from the input into its slot; bigger answers pull harder.
  3. Ink lives: five ink sacs; a life lost squirts ink that dims the screen for a beat; running out ends in a cloud.
  5. Sound (optional, off by default): each rank is a note (#1 highest); a perfect game ends on a chord.
  6. Blitz glow: fast hits make the squid glow brighter (momentum, no scoring change); the score bumps with each
     gain, harder for bigger ones; passing your best flares.
- Rewards follow value, never obscurity: the game rewards big answers, not niche ones.
- Decorations are aria-hidden and never delay game state; tests and screen readers see the final state at once.
  `prefers-reduced-motion` gets static states.
- Play events (`src/game/events.ts`, `onPlay`) are how feedback layers hear about finds, misses, hints and ends.

## 7. The ocean (MVP, October 2026)

The squid leaves the header and lives in a deep-ocean world behind the whole app.

- Backdrop: a retro pixel deep-sea scene behind every screen, drawn at low resolution and scaled up (chunky
  pixels): faint light from far above fading to near-black, drifting marine snow, distant glowing jellies, rocks and
  kelp on the seabed, parallax layers for depth.
- Panels become tinted glass: slightly see-through, so the ocean and the squid show faintly behind the board and the
  text box. Text contrast stays readable.
- One squid, always **behind the UI**. It wanders with squid-like pulse-and-glide swimming. It never needs to dodge
  typing, because it is behind the glass.
- Reactions (behind the glass): its limbs light for answers found; a find makes it dart and glow; a lost life inks
  where it is and darts away; a perfect 10 does loops; Blitz momentum makes it swim faster and glow brighter; idle,
  it sinks and dozes.
- The tentacle grab (input to row) stays in front: it is the one moment that crosses the glass.
- Later (not in the MVP): a seafloor that grows from your history, a lanternfish school for the streak, tap tricks.
