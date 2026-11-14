import { createRoute, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getToken, PairingRejectedError, pair, setToken } from "../../lib/api-client.js";
import { pairingCodeFrom } from "../../lib/pairing.js";
import { isStorageAvailable } from "../../lib/storage.js";
import { rootRoute } from "../__root.js";

export const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  // No nav here (#371): with no token, every place it leads redirects back.
  staticData: { titleKey: "setup:short_title", bare: true },
  beforeLoad: ({ location }) => {
    // A pairing link is followed even with a token stored (#241). That token may be the
    // stale one that sent the user here, and redirecting first would drop the code:
    // /collections would 401, recovery would come back to a /setup with no fragment,
    // and the link the user just opened would have done nothing.
    if (getToken() && pairingCodeFrom(location.hash) === null) throw redirect({ to: "/collections" });
  },
  component: SetupPage,
});

type Pairing = { status: "idle" } | { status: "pairing" } | { status: "failed"; reason: "rejected" | "unreachable" };

function SetupPage() {
  const { t } = useTranslation("setup");
  const navigate = useNavigate();
  const [token, setTokenInput] = useState("");
  // Asked once, before anything is typed. It cannot be said afterwards: a
  // successful connect navigates away from this screen immediately, so a notice
  // rendered post-submit would never be read. Saying it here also puts it in
  // front of the person who has just been asked for the token a second time.
  const [canRemember] = useState(isStorageAvailable);

  // Followed, not read once at mount: a link opened in a tab already on /setup — after
  // Unpair, say — is a same-document navigation that changes only the fragment, and
  // nothing remounts. Reading the code once ignored it silently.
  const linkCode = useRouterState({ select: (state) => pairingCodeFrom(state.location.hash) });
  const [pairing, setPairing] = useState<Pairing>(linkCode === null ? { status: "idle" } : { status: "pairing" });
  // The code is single-use, so it must be sent once. StrictMode runs the effect below
  // twice and keeps refs across its simulated remount, so a ref is the guard that
  // survives it — and the request is deliberately not cancelled in a cleanup, which
  // would abandon the only send.
  const sentCode = useRef<string | null>(null);

  const runPairing = useCallback(
    async (code: string, fromLink: boolean) => {
      if (sentCode.current === code) return;
      sentCode.current = code;
      setPairing({ status: "pairing" });
      try {
        setToken(await pair(code));
        // Replace, so the history entry that held the code is gone too.
        await navigate({ to: "/collections", replace: true });
      } catch (error) {
        setPairing({ status: "failed", reason: error instanceof PairingRejectedError ? "rejected" : "unreachable" });
        // A spent or dead code has no business in the address bar or in history.
        if (fromLink) await navigate({ to: "/setup", replace: true });
      }
    },
    [navigate],
  );

  useEffect(() => {
    if (linkCode !== null) void runPairing(linkCode, true);
  }, [linkCode, runPairing]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // What `disabled` would do, without dropping focus to <body> mid-request.
    if (pairing.status === "pairing") return;
    if (!token.trim()) return;
    const pastedCode = pairingCodeFrom(token);
    if (pastedCode !== null) {
      void runPairing(pastedCode, false);
      return;
    }
    setToken(token);
    void navigate({ to: "/collections" });
  }

  return (
    <div className="setup-page">
      <h1>{t("title")}</h1>
      <p>{t("description")}</p>
      {/* Not role="alert": nothing has failed, and the danger treatment in
          global.css is scoped to that role. The token still works — it just
          will not outlive the tab.

          Not role="status" either (#326). Storage is probed once, in the lazy
          initializer above, so this notice is in the screen's first commit or in
          none of them — and a live region that arrives with the page announces
          nothing. The role bought no announcement and made every page-level
          status query ambiguous. */}
      {!canRemember && <p className="form-hint">{t("no_persistence_notice")}</p>}
      {/* A plain hint for the same reason: when a link was followed it is in the
          first commit, and it is replaced by the app or by the alert below
          within one request. */}
      {pairing.status === "pairing" && <p className="form-hint">{t("pairing_in_progress")}</p>}
      {/* Inserted with its message inside: a role="alert" is announced on insertion. */}
      {pairing.status === "failed" && (
        <p role="alert">{t(pairing.reason === "rejected" ? "pairing_rejected" : "pairing_unreachable")}</p>
      )}
      <form onSubmit={handleSubmit}>
        {/* The row wrapper is not decoration: every input rule in the stylesheet
            is scoped to .form-row, so without it the first screen a new user
            sees renders a bare UA control (#224). */}
        <div className="form-row">
          <label htmlFor="api-token">{t("token_label")}</label>
          <input
            id="api-token"
            type="password"
            value={token}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder={t("token_placeholder")}
            autoComplete="off"
            required
          />
        </div>
        <button type="submit" className="touch-target" aria-disabled={pairing.status === "pairing" ? true : undefined}>
          {t("connect_button")}
        </button>
      </form>
    </div>
  );
}
