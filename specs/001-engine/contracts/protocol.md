# Contract: engine protocol v1

One JSON message per frame (`framed-stream`: a 4-byte little-endian length, then the bytes). Every message
has `v: 1`. Bytes anywhere in params, results or event data are `{ "$bytes": "<base64>" }`.

```
request  { v, id, method, params }
reply    { v, id, result }  |  { v, id, error: { code, message } }
event    { v, event, data }
```

A message whose `v` isn't 1: a request gets `BAD_VERSION`, anything else is dropped. Not JSON, or no
`method`/`event`/known `id`: dropped. Unknown method: `UNKNOWN_METHOD`. Before `init`: `NOT_READY`.
A param of the wrong kind: `INVALID_PARAMS`; a key that isn't 52 z32 characters: `INVALID_KEY`.
Errors from hypergraph and SwarmFS keep their `code` (`NOT_FOUND`, `NOT_ALLOWED`, `INVALID_TYPE`…).

## Requests (shell → engine)

| method | params | result |
|---|---|---|
| `init` | `{ dir, bootstrap?, heartbeat?, appStorageMax? }` | `{ identity, version: 1 }`; `ALREADY` if done |
| `ping` | `{}` | `true` (any message also counts as a heartbeat) |
| `site.publish` | `{ folder }` | `{ key, created, manifest }` (`NO_MANIFEST`, `INVALID_MANIFEST`) |
| `site.open` | `{ key, timeout? }` (z32 key, or an `hg:` invite / public link; timeout ms, default 30000) | `{ key, manifest, dynamic }` |
| `site.read` | `{ key, path, timeout? }` (`''` or `/` = entry) | `{ bytes, path }` (`NOT_FOUND`, `NOT_AVAILABLE`) |
| `site.state` | `{ key }` (spec 002) | `{ complete, peers }`: the site and its pages complete here; peers on the site's space |
| `site.consent` | `{ key, allow }` | `true` |
| `site.call` | `{ key, sub?, method, args?, chain? }` | the call's result |
| `site.live` | `{ key, sub?, args, chain, opts? }` | `{ id }`; then `live` events |
| `site.on` | `{ key, sub?, event }` | `{ id }`; then `event` events |
| `site.off` | `{ id }` | `true` |
| `site.close` | `{ key }` | `true`: its live views and listeners stop, its handle released |
| `close` | `{}` | `true`: everything closed; the engine then ends its stream |

`site.read`, `site.call`, `site.live`, `site.on` need the site opened (`site.open`) in this engine first
(`NOT_FOUND` otherwise). `site.call`/`live`/`on`: `NOT_ALLOWED` for a static site; `NEEDS_CONSENT` before the
person answered, `NOT_ALLOWED` after a no.

`site.call` methods: `put get edit del query linked count sum members decisions tags relate unrelate edges
tag untag getByTag getRole setRole removeRole defineRole roles moderateAction report reports createInvite
revokeInvite createSubspace subspaces redemptions peers status isComplete completeFrom types info`.
`info` returns `{ key, name, parent, private, typesVersion, history, helpers, identity }`. `query` takes
`chain`: `[[name, args], ...]` of `by on where tag since until moderated fromDevice`, ending with
`latest` (`[['latest', [20, { after }]]]`). `sub`: a sub-space key of the site (`NOT_ALLOWED` otherwise).

## Events (engine → shell)

| event | data |
|---|---|
| `live` | `{ id, items, complete }`: a live query's new answer |
| `event` | `{ id, data }`: a site event (`change`, `peers`, `members`, `decisions`, `status`) |
| `closing` | `{ reason }` (`heartbeat` or `close`), sent just before the engine ends its stream |
