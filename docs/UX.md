# UX principles (learned from the owner's feedback)

Every piece of UI feedback from the owner becomes a principle here, with the example that taught it, so the same kind
of issue doesn't reach him twice. Agents check their work against this list before reporting a UI change done, and
the UI reviewer (`.claude/agents/ui-review.md`) checks every UI change against it before it merges.

**When the owner sends feedback:** fix the instance; add or sharpen a principle below; where possible add a check that
enforces it (a test, `lint:css`, the judge brief); then sweep the other screens for the same pattern.

## Words

1. **Say what happens, in plain words.** A button names its effect: "Roll new list" for a new random list (not
   "Play again", which reads as the same list), "Play Blitz" (not "Blitz"). A number says what it is: "average" (not "par",
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
   too much space", "the height is still too tall"). A key beside a panel is as tall as the row it sits by, not the
   whole panel, and its label is short enough to read without squeezing: "Roll another list" stretched to the Blitz
   card's full 261px and crammed into three lines on a phone ("desktop, the new button is too tall, mobile, the
   words are too crammed"), so it became "Roll new list", as tall as the guess row.
8. **Aligned.** Things in a row share one baseline and one height (free play keys).
9. **Popovers float.** A dropdown, picker or note opens over the page and never grows the panel it came from (the
   by-category picker).
10. **Never hide a section because it's empty.** Show it with a placeholder (the Stats tab disappeared for a new
    player).
23. **One box, one job.** A panel holds one action and what serves it; a different action gets its own box beside it.
    Roll again sat inside the guess panel, squeezing the guess box and its placeholder: "separate out the roll again
    button completely outside the guess box, make its own separate box to the right of this whole thing" (now "Roll
    new list", in its own box right of the guess panel, in free play and Blitz).

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

19. **Show where the player stands, compactly: a small header key lit when signed in, never a row of its own.**
    Whether you're signed in reads on Home at a glance, not behind the menu ("this way you can easily tell if you are
    logged in or not"), and in the smallest space that says it: one keycap in Home's header, left of the sound key, a
    pixel player hollow when signed out and lit cyan when signed in, a pink dot when the sync needs a look. Its name
    and title say it in words ("Account: signed in as Dana"); the sheet it opens says the rest. A card under Today's
    pair said the same in a whole row: "I hate how the sign-in thing takes up an entire row of space in the center
    ... at the most, you should have a small icon next to the home button or the settings button, or something more
    discreet that just shows, in a useful manner, whether or not you're signed in. This is just a terrible waste of
    space." Status never spends prime space. Home never shows an email address. (`e2e/backend.e2e.cjs`: each state's
    icon and name, and nothing between Today and Free play.)
20. **A finger is not a mouse.** On a phone a tap leaves hover behind (hover looks live under `@media (hover:
    hover)`), every control is 44px to the finger (a key's base counts), quick taps never zoom, and the narrowest
    phone (320px) still shows every word that matters: the clue's cost, the guess box's placeholder, a long answer
    whole. ("some ui bugs on the mobile version"; `lint:css` and `e2e/touch.e2e.cjs` enforce it.)

## Scores

21. **A score shows its yardstick, and the yardstick is a plain rule.** The screen says how points are counted, in
    words that agree with the numbers, and the rule is one the player can check, never a number someone made up.
    Fathom first scored each guess against a judge's estimate of how far off people usually are on that question and
    said so ("most people miss by about 1.3x", "a typical guesser scores about 250"); the owner, after playing: "most
    people miss by about x feels made up", and a guess 10x off still scored well where that was usual. Now one rule
    for every question is the yardstick, said where the player looks before the first answer and again on the
    results: "Half or double the answer scores about 50. Ten times off scores 0." Whatever reads "spot on" scores 100
    (it had shown 99), and the miss reads plainly ("30% low", "3x too high"). Other players come in only as real
    players, once there are 20 of them on a question. (`e2e/fathom.e2e.cjs`, `src/game/fathom.test.ts`.)

## Scope

22. **Spend the effort where players are.** Build the common case simply and skip rules for cases that take several
    unlikely things at once. Multiple clues on one answer: each letter costs a life, and nothing stops a player
    revealing a whole name, since that needs a short answer and every life ("not a use case that's worth spending
    time ... focus on what matters").
