# UX principles (learned from the owner's feedback)

Every piece of UI feedback from the owner becomes a principle here, with the example that taught it, so the same kind
of issue doesn't reach him twice. Agents check their work against this list before reporting a UI change done, and
the UI reviewer (`.claude/agents/ui-review.md`) checks every UI change against it before it merges.

**When the owner sends feedback:** fix the instance; add or sharpen a principle below; where possible add a check that
enforces it (a test, `lint:css`, the judge brief); then sweep the other screens for the same pattern.

## Words

1. **Say what happens, in plain words.** A button names its effect: "Roll again" for a new random list (not "Play
   again", which reads as the same list), "Play Blitz" (not "Blitz"). A number says what it is: "average" (not "par",
   asked about twice), "days in a row" (not "streak").
2. **No jargon a casual player has to decode.** Golf, stats or game-design terms (par, percentile, streak, delta)
   get replaced or explained on the screen itself.
3. **Titles name what the player types and by what measure** ("Countries emitting the most CO2", not "Biggest CO2
   emitters", which had players guessing cars; "most certified sales and streams", not "best-selling").

## Layout

4. **Structure over repetition.** Don't repeat the same tag or label on every row or screen part; say it once in a
   header or a column (the archive's LIST/BLITZ pill on every row; the Blitz title card repeating the header's
   BLITZ).
5. **Every element earns its place.** Info that doesn't help the next decision goes ("5 lives" and "90 s" boxes on
   free play read as random).
6. **The main thing gets the most room.** Today's list is the main feature: two thirds of the row, Blitz one third.
7. **Compact by default.** Keys no taller than their content needs; side by side when the width allows ("takes up
   too much space", "the height is still too tall").
8. **Aligned.** Things in a row share one baseline and one height (free play keys).
9. **Popovers float.** A dropdown, picker or note opens over the page and never grows the panel it came from (the
   by-category picker).
10. **Never hide a section because it's empty.** Show it with a placeholder (the Stats tab disappeared for a new
    player).

## Behavior

11. **Nothing moves on hover, focus or press.** Only color, shadow, opacity and transform change (the Today key grew
    on hover). Enforced by `npm run lint:css` and `e2e/states.e2e.cjs`.
12. **Phone first, no hover-only meaning.** Phones have no hover; anything explained on hover also opens on tap.
13. **Save the comparison for the end.** During play the player sees only their own score; the average and where
    they stand are revealed on the results, the hook to see how they did (par was dropped from the game header).
14. **One mental model per mode.** Dailies are one try; free play is endless and new every time (Play again rolled the
    same list).
15. **Never spoil a daily.** Nothing shows a list's answers before its day: random play never lands on today's or a
    future day's list or Blitz (a random list landed on today's Blitz topic).
16. **Generous, never unrelated.** Autocorrect helps partial knowledge ("shenzhen", "jordan") but never turns an
    unrelated word into an answer ("pope").

## Look

17. **Keep the brand look unless asked.** Don't retune the palette or type (the pink and yellow were faded once,
    unasked). The visual baselines are the reference.
18. **Third-party pieces come in our own language.** A widget drawn by someone else (Google's sign-in button, in its
    own font and fill) looks out of place: build our own key and keep only what trust needs (Google's G, unaltered).

## Status and touch

19. **Show where the player stands where they land.** Whether you're signed in reads on Home at a glance (a lit or
    hollow player, "signed in as Dana" or "not signed in"), not behind the menu ("this way you can easily tell if you
    are logged in or not"). Home never shows an email address.
20. **A finger is not a mouse.** On a phone a tap leaves hover behind (hover looks live under `@media (hover:
    hover)`), every control is 44px to the finger (a key's base counts), quick taps never zoom, and the narrowest
    phone (320px) still shows every word that matters: the clue's cost, the guess box's placeholder, a long answer
    whole. ("some ui bugs on the mobile version"; `lint:css` and `e2e/touch.e2e.cjs` enforce it.)
