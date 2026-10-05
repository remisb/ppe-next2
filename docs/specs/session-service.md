# Session service

Sign-ins: one session per sign-in on one browser, which holds it as an HttpOnly refresh
cookie. Package `internal/domain/session`, routes in `cmd/api/auth-routes.go` and
`cmd/api/auth-cookie.go`, table from migration `0020_user_sessions`. The user service
(`docs/specs/user-service.md`) owns accounts and passwords; this one owns how long a
sign-in lasts and how it ends.

## Why

The access token is a 15-minute JWT that cannot be revoked. Before sessions it lived in the
tab's sessionStorage and was renewed only while the tab was open, so closing the tab or
letting the device sleep for a quarter of an hour meant signing in again, and a password
reset left existing sign-ins running. A session is revocable, so it can last weeks; the
cookie keeps it out of any script's reach. See the report "Staying Signed In" for the
options weighed (option B with C).

## Entity (`user_sessions`)

| Field | Notes |
| --- | --- |
| `id` | UUID; the access token's `sid` claim |
| `user_id` | FK to `users`; `TRUNCATE users CASCADE` empties sessions too |
| `seed`, `generation` | The refresh token is derived from them (below); never the token itself |
| `rotated_at` | When `generation` last moved |
| `keep_signed_in` | Keep me signed in |
| `created_at` | Sign-in |
| `authenticated_at` | When the password was last entered: sign-in, or `POST /auth/reauth`; the access token's `auth_time` |
| `last_used_at`, `user_agent`, `ip` | From the last refresh, for the device list (the User-Agent is cut to 400 bytes) |
| `idle_expires_at`, `expires_at` | The idle and absolute limits |
| `ended_at`, `end_reason` | Set together; `signed_out`, `ended_elsewhere`, `password_changed`, `password_reset`, `deactivated`, `deleted` or `reused` |

Sessions are not soft-deleted like the domain's records: they end. Ended and expired rows
stay 30 days for tracing and are deleted at the same user's next sign-in.

## Refresh tokens

`<session id>.<generation>.<mac>`, the mac an HMAC-SHA256 of the id, the seed and the
generation under a key derived from `API_JWT_SECRET` (`sessionKey`, `cmd/api/main.go`). The
server recomputes the mac to check a token and can send the current one again; a copy of the
table cannot make one. A new `API_JWT_SECRET` signs everyone out.

Each refresh moves the generation on and the browser gets the next token (rotation). The
token just replaced is accepted for `RotationGrace` (2 minutes) and answered with the
current one, unchanged: a second tab that refreshed at the same moment, or a reply lost on
a phone's network, does not end the sign-in. Any other token with a valid mac is a copy used
after it was replaced, so the session ends (`reused`), for the holder of the current token
too (RFC 9700 §4.14: refresh token rotation with reuse detection).

## Limits

| Setting | Default | Applies to |
| --- | --- | --- |
| `API_SESSION_MAX_AGE` | 12h | without Keep me signed in: after sign-in; the cookie also ends with the browser |
| `API_SESSION_KEEP_MAX_AGE` | 720h (30 days) | with it: after sign-in (at least `API_SESSION_MAX_AGE`, at most 2160h) |
| `API_SESSION_KEEP_IDLE` | 336h (14 days) | with it: unused (at least `API_JWT_TTL`, at most the above) |
| `API_RECENT_SIGN_IN` | 12h | managing users needs the password entered within this (at least 5m) |

30 days for a password sign-in matches NIST SP 800-63B-4's AAL1 reauthentication limit.

## Routes

| Route | Access | Notes |
| --- | --- | --- |
| `POST /api/v1/auth/login` | public, rate-limited (see the user service) | body `{email, password, keep_signed_in}`; sets the cookie, returns the access token and user |
| `POST /api/v1/auth/refresh` | public (the cookie) | rotates the cookie, returns a new access token and the user; reads the account again (new roles apply, a deactivated or deleted user is refused). Every refusal is a 401 that clears the cookie |
| `POST /api/v1/auth/logout` | public (the cookie) | ends the cookie's session, clears the cookie, always 204 |
| `POST /api/v1/auth/reauth` | any authenticated user, rate-limited like login | body `{password}`; a wrong one is a 400 naming `password` (not a 401, which would sign the app out) and counts against the email limit; returns an access token with `auth_time` now. 401 if the session has ended |
| `GET /api/v1/auth/sessions` | any authenticated user | the user's live sessions, last used first, `current` marking the token's own |
| `DELETE /api/v1/auth/sessions/{id}` | any authenticated user | ends one of the user's sessions (`ended_elsewhere`); another user's is a 404 |
| `DELETE /api/v1/auth/sessions` | any authenticated user | ends all the user's sessions but the token's own |

The cookie `ppe_refresh` is `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth`, and
`Secure` when `API_PUBLIC_BASE_URL` is https (a plain-http development address leaves it off
so every browser keeps it on localhost). With Keep me signed in it carries `Max-Age` up to
the absolute limit; without, none, so it ends with the browser.

Login, refresh and logout refuse (403) a request whose `Origin` is neither the app's own
(`API_PUBLIC_BASE_URL`, `API_ALLOWED_ORIGINS`) nor the host it was sent to; browsers send
`Origin` with every POST. SameSite already keeps the cookie off other sites' requests; this
also stops another site signing a browser in to an account of its choosing. The Vite dev
proxy keeps the browser's `Host` (`changeOrigin: false`) so this holds on any port.

## Ending sessions

| Event | Ends |
| --- | --- |
| Sign out | this browser's session |
| Sign out on Account's device list | that session; Sign out all other devices: all but this one |
| Own password changed (`PUT /users/me/password`) | all but the one it was changed in |
| Password reset by an administrator | all |
| Account deactivated or deleted | all |
| A replaced refresh token used after the grace | that session |

The user service calls `user.Sessions.EndAll` (answered by `userSessions` in
`cmd/api/checkers.go`) after the change is written. An access token already issued stays
valid until it expires (at most `API_JWT_TTL`); the next refresh is refused. A role change
needs no ending: it reaches the user at their next refresh.

## Recent sign-in

`POST`/`PUT`/`DELETE` on `/api/v1/users` (adding, editing, resetting the password of and
deleting users) answer 403 `recent sign-in required` when the token's `auth_time` is older
than `API_RECENT_SIGN_IN` (`requireRecentSignIn`). The web app's client recognises the
message, asks for the password (Confirm your password), calls `POST /auth/reauth` and sends
the request again; cancelling leaves the 403, which the screen reports as "nothing was
changed". Changing one's own password needs the current one anyway.

## Web app

`web/apps/workwear/src/lib/api.tsx`: the access token lives in memory only. At start-up
the app asks `POST /auth/refresh` whether the browser is signed in (Checking your sign-in…;
the server unreachable shows a Retry that also fires when the device is back online). It
refreshes when the token has under 10 minutes left (checked each minute, when the tab is
shown and when the device is back online), and a request refused with 401 refreshes once
and is sent again. Tabs take turns refreshing under a Web Lock (`withRefreshLock`); Sign
out tells the browser's other tabs over a BroadcastChannel. Keep me signed in starts ticked
unless it was unticked at the last sign-in on that device (`workwear.keepSignedIn` in
localStorage). The legacy sessionStorage token is removed at start-up; after this change
everyone signs in once.
