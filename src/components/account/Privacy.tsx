import { accountsOn, BACKEND, backendOn, PRIVACY_CONTACT } from "../../net/config";
import { ScreenHead } from "../pixel";
import "./account.css";

/**
 * What the game keeps, why, and how to delete it, in plain words. The page describes this build: without a backend
 * nothing leaves the browser, and it says so.
 */
export default function Privacy({ onBack, onHome }: { onBack: () => void; onHome: () => void }) {
  return (
    <main className="screen archive privacy" data-testid="privacy">
      <ScreenHead onBack={onBack} onHome={onHome}>
        <span className="label mode">Privacy</span>
      </ScreenHead>

      <section data-glass className="panel prompt">
        <h1>Privacy</h1>
        <p className="caption">
          {backendOn ? "what this game keeps, and why. short version: scores, not people." : "this copy of the game has no server. your games stay in this browser."}
        </p>
      </section>

      <section data-glass className="panel privacy-part" aria-labelledby="pv-device">
        <h2 id="pv-device" className="label cyan">
          In this browser
        </h2>
        <ul>
          <li>Your games, streaks, bests and settings are kept in this browser's local storage.</li>
          {backendOn && <li>So is a random id for this browser, made up on the spot. It only stops one game being counted twice.</li>}
          <li>
            No cookies, no ads, no tracking.
            {accountsOn && " Signing in keeps its session in local storage too, not in a cookie."}
          </li>
        </ul>
      </section>

      {backendOn && (
        <section data-glass className="panel privacy-part" aria-labelledby="pv-scores">
          <h2 id="pv-scores" className="label cyan">
            Scores
          </h2>
          <ul>
            <li>
              When you finish a game, the game sends: the list, list or Blitz, your score, how many you found, when the game
              started, whether it was the daily, and the random id. Nothing else.
            </li>
            <li>Why: so the results can show how everyone does on a list, and where you stand.</li>
            <li>
              When you rate a list ("Good list?"), the game sends the list, list or Blitz, up or down, the reason if you
              picked one, and the random id. Why: to learn which lists are good.
            </li>
            <li>
              These scores don't say who you are, so they can't be picked out and deleted later. They stay in the
              totals.
            </li>
          </ul>
        </section>
      )}

      {backendOn && (
        <section data-glass className="panel privacy-part" aria-labelledby="pv-notes" data-testid="privacy-notes">
          <h2 id="pv-notes" className="label cyan">
            Notes
          </h2>
          <ul>
            <li>
              When you add a note to a list, the game sends what you wrote, the list, list or Blitz, your rating of it
              then, and the random id. Nothing else.
            </li>
            <li>Why: to make the lists better. Only the game's owner reads notes. Nobody else sees them.</li>
            <li>So leave personal details out of them.</li>
            <li>
              {accountsOn
                ? "Notes sent while signed in are linked to your account and go when you delete it. Notes sent signed out aren't linked to anyone, so they stay."
                : "Notes aren't linked to anyone, so they can't be picked out and deleted later."}
            </li>
          </ul>
        </section>
      )}

      {accountsOn && (
        <section data-glass className="panel privacy-part" aria-labelledby="pv-account">
          <h2 id="pv-account" className="label cyan">
            If you sign in
          </h2>
          <ul>
            <li>Your email address, to sign you in. With Google, also the name and picture Google sends.</li>
            {BACKEND?.signIn.includes("password") && (
              <li>With a password, only a scrambled form of it (a hash) is stored. Nobody can read it back, us included.</li>
            )}
            <li>
              Your save: the same games, streaks and bests this browser keeps, so they follow you to other devices.
            </li>
            <li>The scores, ratings and notes you send while signed in are linked to your account.</li>
            <li>Why: signing in and syncing. Your email is never used for anything else.</li>
          </ul>
        </section>
      )}

      <section data-glass className="panel privacy-part" aria-labelledby="pv-who">
        <h2 id="pv-who" className="label cyan">
          Who handles it
        </h2>
        <ul>
          {backendOn && <li>Supabase stores the scores, ratings and notes{accountsOn ? ", saves and sign-ins" : ""}.</li>}
          <li>
            Vercel hosts the game.
            {backendOn
              ? " Like any server, both see your IP address and keep it in short-lived logs. The game itself never stores it."
              : " Like any server, it sees your IP address and keeps it in short-lived logs."}
          </li>
          {BACKEND?.signIn.includes("google") && (
            <li data-testid="privacy-google">
              Continue with Google takes you to Google's sign-in page, which sees that visit like any server. Nothing
              comes from Google before you press it.
            </li>
          )}
          <li>The font comes from Google Fonts. The lists come from Wikipedia, read when the puzzles were made.</li>
        </ul>
      </section>

      <section data-glass className="panel privacy-part" aria-labelledby="pv-delete" data-testid="privacy-delete">
        <h2 id="pv-delete" className="label cyan">
          Deleting it
        </h2>
        <ul>
          {accountsOn && (
            <li>
              Signed in: <a href="#">Home</a>, the player key at the top, delete account. That removes your save, your
              linked scores, ratings and notes, and your sign-in, right away.
            </li>
          )}
          <li>
            In this browser: <a href="#settings">Settings</a>, reset all progress, or clear this site's data in your browser's
            settings.
          </li>
          {PRIVACY_CONTACT && (
            <li>
              Anything else: <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>.
            </li>
          )}
        </ul>
      </section>
    </main>
  );
}
