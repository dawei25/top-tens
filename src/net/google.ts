/**
 * Google sign-in with Google's own button (Google Identity Services, "Sign in with Google"). The button lives on this
 * site and opens Google's popup from it, so Google's account chooser names this site rather than the Supabase project
 * a redirect would go through. Google hands the page an ID token; Supabase trades it for a session
 * (`signInWithGoogleToken` in ./service).
 *
 * Google's script is loaded only when the sign-in sheet opens in a build with VITE_GOOGLE_CLIENT_ID (see
 * ../components/account/GoogleSignIn.tsx), never at startup.
 *
 * Nonce (Supabase's recipe for Google's pre-built button): a random nonce per button; Google gets its SHA-256 (hex)
 * and puts that in the ID token; Supabase gets the nonce itself, hashes it and checks they match, so a token taken
 * from elsewhere can't be replayed here.
 */

export const GIS_SRC = "https://accounts.google.com/gsi/client";

/** What Google's button hands back. */
export interface CredentialResponse {
  /** The ID token (a JWT). */
  credential: string;
  select_by?: string;
}

/** The parts of `google.accounts.id` the game uses. */
export interface GoogleId {
  initialize(config: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    nonce?: string;
    ux_mode?: "popup" | "redirect";
    context?: "signin" | "signup" | "use";
    auto_select?: boolean;
    use_fedcm_for_button?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type: "standard" | "icon";
      theme?: "outline" | "outline_dark" | "filled_blue" | "filled_black";
      size?: "large" | "medium" | "small";
      text?: "signin_with" | "signup_with" | "continue_with" | "signin";
      shape?: "rectangular" | "pill" | "circle" | "square";
      logo_alignment?: "left" | "center";
      width?: number;
      locale?: string;
      click_listener?: () => void;
    },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

const gis = (): GoogleId | undefined => window.google?.accounts?.id;

let loading: Promise<GoogleId> | null = null;

/**
 * Google's script, added to the page once. Rejects if it doesn't arrive within `timeout` (blocked, offline); the next
 * call tries again.
 */
export function loadGis(timeout = 12_000): Promise<GoogleId> {
  const ready = gis();
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<GoogleId>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      loading = null;
      reject(new Error("Google's sign-in script didn't load"));
    };
    const timer = setTimeout(fail, timeout);
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      const id = gis();
      if (id) resolve(id);
      else fail();
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return loading;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** A fresh nonce, and the SHA-256 (hex) of it that Google puts in the ID token. */
export async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = hex(crypto.getRandomValues(new Uint8Array(32)));
  const hashed = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))));
  return { raw, hashed };
}

/** The `nonce` claim of an ID token (read, not verified: Supabase verifies the token). */
export function tokenNonce(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
    return typeof claims?.nonce === "string" ? claims.nonce : null;
  } catch {
    return null;
  }
}

/** Google allows its button 200 to 400 px wide (below 200 it drops the "Continue as Dana" form). */
export const buttonWidth = (available: number): number => Math.max(200, Math.min(400, Math.floor(available)));

export interface GoogleButton {
  /** Draw Google's button again at the width its box has now (after a resize). */
  redraw(): void;
  /** Ask with a new nonce from now on (after a token was used). */
  renew(): Promise<void>;
}

/**
 * Google's button in `el`, ready to press: `onPress` when pressed (its popup opens), `onCredential` with the ID token
 * and the nonce it was asked with, ready for Supabase. Rejects if Google's script can't load.
 */
export async function googleButton(
  el: HTMLElement,
  clientId: string,
  on: { credential: (token: string, nonce: string) => void; press?: () => void },
): Promise<GoogleButton> {
  const id = await loadGis();
  // Every nonce this button asked with, by its hash, so a token always goes to Supabase with its own nonce.
  const issued = new Map<string, string>();
  let current = "";
  let width = 0;
  const draw = () => {
    width = buttonWidth(el.clientWidth);
    el.replaceChildren();
    id.renderButton(el, {
      type: "standard",
      theme: "filled_black",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      width,
      locale: "en",
      click_listener: () => on.press?.(),
    });
  };
  const renew = async () => {
    const { raw, hashed } = await makeNonce();
    issued.set(hashed, raw);
    current = raw;
    id.initialize({
      client_id: clientId,
      nonce: hashed,
      // The popup (not One Tap, not the browser's FedCM dialog): the same flow in every browser, Safari included.
      ux_mode: "popup",
      use_fedcm_for_button: false,
      auto_select: false,
      context: "signin",
      callback: (r) => {
        const hashedNonce = tokenNonce(r.credential);
        on.credential(r.credential, (hashedNonce && issued.get(hashedNonce)) || current);
      },
    });
    draw();
  };
  await renew();
  return {
    redraw: () => {
      if (buttonWidth(el.clientWidth) !== width) draw();
    },
    renew,
  };
}
