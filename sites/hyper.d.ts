// The site API: `window.hyper`, as HyperBrowser gives it to a page (shell/site-preload.cjs) and its engine answers it
// (engine/index.js). For site authors: reference this file from a site's jsconfig.json, or with
// /// <reference path="hyper.d.ts" />, to have every call checked and completed by the editor.
//
// A page gets `window.hyper` only in HyperBrowser, and only when its site.json has "permissions": ["space"]:
// test for it before using it. Every call is a promise. A refused call rejects with a plain
// `{ name: 'HyperError', code, message }` (Hyper.Failure), never an Error: read `err.code`.
// What comes back is plain data (JSON values and Uint8Array bytes): no methods, no classes.

declare namespace Hyper {
  /** A z32 key: a site's, a space's, a person's (identity) or a device's. 52 characters. */
  type Key = string

  /** How a call is refused. `code` says why: `NOT_ALLOWED`, `NOT_FOUND`, `INVALID_PARAMS`, `NEEDS_CONSENT`... */
  interface Failure {
    name: 'HyperError'
    code: string
    message: string
  }

  /** Stops a subscription (live queries, events). */
  type Unsubscribe = () => void

  /**
   * A record's own fields, as its type in site.json declares them. Name them for your types with
   * `Hyper.Record<{ title: string, body: string }>`.
   */
  type Fields = { [field: string]: any }

  /** A record, with the fields every record has. */
  type Record<F extends object = Fields> = F & {
    /** Its id: stays the same through edits. */
    id: string
    type: string
    /** Who wrote it (an identity key). */
    author: Key
    /** The device it was written on. */
    device: Key
    /** When it was put (ms since 1970, the author's clock). */
    stamp: number
    edited: boolean
    /** Hidden by a moderator: shown to moderators only. */
    hidden?: true
    flagged?: true
    /** Sealed for others (a private record): its fields are not there. */
    unreadable?: true
    /** Its content was dropped on this device (storage budgets): only these fields are left. */
    dropped?: true
    /** Stamped later than now by its author's clock. */
    futureStamp?: true
  }

  /** A list read. `complete` is false while records known of are still on their way: show what is there, it grows. */
  interface Page<F extends object = Fields> {
    items: Array<Record<F>>
    complete: boolean
  }

  /** Who deleted a record: its author, or the space (a moderator). */
  type Deletion = { by: 'author', stamp: number, device: Key } | { by: 'space' }

  /** A relation between two records (relate()). */
  interface Edge {
    id: string
    from: string
    to: string
    type: string
    value: number | null
    data: string | null
    author: Key
    stamp: number
  }

  /** Records point at records: by a record or its id. */
  type Target = { id: string } | string

  /** A query on one type of records. Filters combine; end with latest() or live(). Newest first. */
  interface Query<F extends object = Fields> {
    /** Records written by this person. */
    by (identity: Key): Query<F>
    /** Records pointing at this record (their first link field). */
    on (record: Target): Query<F>
    /** Records whose fields have these values (an index of the type must cover them). */
    where (fields: { [field: string]: unknown }): Query<F>
    /** Records with this tag. */
    tag (name: string): Query<F>
    /** Put at or after this time (ms). */
    since (ms: number): Query<F>
    /** Put before this time (ms). */
    until (ms: number): Query<F>
    /** Records in this moderation state: 'hidden' or 'flagged'. */
    moderated (state: 'hidden' | 'flagged'): Query<F>
    /** Records written on this device. */
    fromDevice (device: Key): Query<F>
    /** The newest `n` (20 by default); `after`: the last record of the previous page. */
    latest (n?: number, opts?: { after?: Record | null, timeout?: number }): Promise<Page<F>>
    /** Called now and on every change, with the newest `limit` records. */
    live (fn: (page: Page<F>) => void, opts?: { limit?: number }): Unsubscribe
  }

  interface Member {
    identity: Key
    role: string | null
    /** This person. */
    you: boolean
    banned: boolean
    removed: boolean
    /** `added`: when the device joined an encrypted conversation that hides its history (ms), else null. */
    devices: Array<{ device: Key, log: string, added: number | null }>
  }

  interface Peer {
    /** null for a moment, until the peer's device proof arrives. */
    identity: Key | null
    device: Key
  }

  interface Role { name: string, permissions: string[], custom: boolean }

  /** A record type as the space keeps it. */
  interface TypeInfo {
    fields: { [field: string]: string }
    links: { [field: string]: string[] }
    onePerMember: boolean
    editable: 'author' | 'members' | { permission: string }
    index: string[][]
    /** Every member reads its records, newcomers to an encrypted conversation too (app state, never content). */
    shared: boolean
    builtin: boolean
  }

  /** What this device holds of the space, and how it is doing. */
  interface Status {
    policy: string
    access: string
    held: string
    heldFrom: number | null
    stored: number
    share: number | null
    budget: number | null
    belowPolicy: boolean
    peers: number
    settlers: number
    warnings: Array<{ code: string, message: string }>
    complete: boolean
  }

  /** How many devices keep the space: wanted, kept, and online now. */
  interface Copies { wanted: number, kept: number, online: number }

  interface Info {
    /** This person's identity. */
    identity: Key
    key: Key
    name: string | null
    /** The space it is inside of, for a sub-space. */
    parent: Key | null
    private: boolean
    typesVersion: number
    /** Who reads a private space's history: 'visible' (newcomers read it) or 'hidden' (each member from its join on, each message with its own key). */
    history: string
    /** Messages go after this many ms on every member's device; null: they stay. */
    disappearing: number | null
    helpers: Key[]
    /** It was secured (secure()): a new space took its place. */
    moved: boolean
    /** That new space, if this person was taken along. */
    movedTo: Key | null
    renewal: { from: Key, waiting: boolean } | null
    /** For an instance: its app's key. */
    app: Key | null
  }

  /** A space's events and what each listener gets. */
  interface Events {
    /** Records changed: their ids, types and whether they were deleted. */
    change: { types: string[], records: Array<{ id: string, type: string, deleted: Deletion | null }> }
    peers: Peer[]
    members: null
    /** A member added a device (a conversation that hides its history): it reads from now on. */
    devices: { identity: Key, device: Key, added: number }
    decisions: null
    status: Status
    copies: Copies
  }

  /** A space: the site's own, one of its sub-spaces, or an instance. */
  interface Space {
    /** Writes a record of a type the site declares. */
    put<F extends object = Fields> (type: string, values: F): Promise<Record<F>>
    get (id: Target, opts?: { timeout?: number }): Promise<{ record: Record | null, complete: boolean, deleted: Deletion | null }>
    /** Changes some fields; the others stay, and so does its id. Its author edits it, or editors of a shared type. */
    edit (id: Target, changes: Fields): Promise<Record>
    /** Deletes a record: its author's; a moderator's del() of someone else's takes it down. */
    del (id: string): Promise<null>
    query<F extends object = Fields> (type: string): Query<F>
    /**
     * The records received past a cursor, for unread marks. `cursor` is plain JSON: keep it across visits (mine.set).
     * null: from now on. At most `limit` (1000) at a time.
     */
    since (cursor: { [log: string]: number } | null, opts?: { types?: string[] | null, limit?: number }): Promise<{ records: Record[], cursor: { [log: string]: number } }>
    /** The records pointing at a record, oldest first. */
    linked (target: Target, type?: string | null, opts?: { timeout?: number }): Promise<Page>
    count (type: string, opts: { on: Target, timeout?: number }): Promise<{ value: number, complete: boolean }>
    sum (type: string, field: string, opts: { on: Target, timeout?: number }): Promise<{ value: number, complete: boolean }>
    members (): Promise<Member[]>
    /** The moderation log, newest first: `seq`, `type`, `by`, `device`, `at`, `counted`, and what was decided. */
    decisions (opts?: { limit?: number, after?: number | { seq: number } | null }): Promise<{ items: Array<{ seq: number, type: string, by: Key | null, device: Key | null, at: number, counted: boolean, [field: string]: unknown }>, complete: boolean }>
    tags (record: Target, opts?: { timeout?: number }): Promise<{ items: string[], complete: boolean }>
    relate (from: Target, to: Target, type: string, opts?: { value?: number | null, data?: string | null }): Promise<Edge>
    unrelate (from: Target, to: Target, type: string): Promise<null>
    edges (record: Target, opts?: { direction?: 'in' | 'out' | 'both', type?: string | null, order?: 'asc' | 'desc', limit?: number, timeout?: number }): Promise<{ items: Edge[], count: number, complete: boolean }>
    tag (record: Target, name: string): Promise<null>
    untag (record: Target, name: string): Promise<null>
    getByTag (name: string, opts?: { type?: string | null, limit?: number, after?: Record | null, timeout?: number }): Promise<Page>
    getRole (identity: Key): Promise<string | null>
    /** Gives someone a role ('admin', 'moderator', 'member', 'guest' or one of defineRole()). */
    setRole (identity: Key, role: string): Promise<null>
    removeRole (identity: Key): Promise<null>
    defineRole (name: string, permissions: string[]): Promise<null>
    roles (): Promise<Role[]>
    /** 'flag', 'hide', 'reveal', 'remove' (a record or a report), 'ban' or 'unban' (an identity). */
    moderateAction (action: string, target: Target, opts?: { reason?: string, from?: Target | null, drop?: 'all' | null }): Promise<null>
    /** Reports a record to the moderators, privately. */
    report (record: Target, opts?: { reason?: string }): Promise<{ id: string, stamp: number }>
    /** The reports a moderator can read, by reported record. */
    reports (opts?: { timeout?: number }): Promise<{ items: Array<{ on: string, count: number, reports: Array<{ id: string, by: Key, reason: string, stamp: number }> }>, complete: boolean }>
    /** An invite link (hg:...). */
    createInvite (opts?: { role?: string, uses?: number, expires?: number, subspaces?: Key[] }): Promise<string>
    revokeInvite (link: string): Promise<null>
    createSubspace (opts?: { name?: string, private?: boolean, writeRoles?: string[] }): Promise<{ key: Key, name: string | null }>
    subspaces (): Promise<Array<{ key: Key, name: string, private: boolean }>>
    /** Who came in with an invite link, and when. */
    redemptions (link: string): Promise<Array<{ identity: Key, at: number | null }>>
    peers (): Promise<Peer[]>
    status (): Promise<Status>
    /** Whether everything known of is here. */
    isComplete (): Promise<boolean>
    /** Whether everything from this time (ms) on is here. */
    completeFrom (stamp: number): Promise<boolean>
    types (): Promise<{ [type: string]: TypeInfo }>
    info (): Promise<Info>
    /** How many devices keep this space, or one of its sub-spaces or the app's instances (by key). */
    copies (key?: Key | null): Promise<Copies>
    /** A new key for a private space (owners and admins). */
    rotateKey (): Promise<null>
    /** Moves the space to a new key without the people removed or banned; `forget`: also leave its history behind. */
    secure (opts?: { forget?: boolean }): Promise<{ key: Key }>
    /** Deletes the records written before a time (ms), everywhere they are held. Copies already taken stay. */
    trimHistory (opts: { before: number }): Promise<null>
    /** 'hidden': newcomers read from their join on, each message has its own key, erased when it goes; 'visible': newcomers read the history (owners and admins, private spaces). */
    setHistory (history: 'visible' | 'hidden'): Promise<null>
    /** Messages go after `ms` (at least 60000) on every member's device; null: off (owners and admins, private spaces). A modified app can keep what it read. */
    setDisappearing (ms: number | null): Promise<null>
    on<E extends keyof Events> (event: E, fn: (data: Events[E]) => void): Unsubscribe
  }

  /** The site's own space or one of its app's instances: they also have sub-spaces and the person's own notes. */
  interface Place extends Space {
    subspace (key: Key): Space
    /** Settings kept for this person, on all their devices, never in the space. A value is JSON, at most 64 KB. */
    mine: {
      all (): Promise<{ [name: string]: unknown }>
      /** null or undefined removes it. */
      set (name: string, value: unknown): Promise<true>
    }
  }

  /** A contact, as Contacts and Chat see them. */
  interface Contact {
    identity: Key
    name: string
    state: 'incoming' | 'outgoing' | 'friend'
    /** Your conversation with them in Chat. */
    chat: Key
    at: number
  }

  interface Project {
    key: Key
    name: string
    /** Its folder on this computer (null until it is there). */
    folder: string | null
    /** The site it publishes to, once published. */
    site: Key | null
    role: string | null
  }

  type ProjectFile = { path: string, size: number, mtime: number } | { path: string, folder: true }

  /** A watch to follow: as a notifications entry of site.json, plus `place` (one of the app's instances). */
  interface Follow {
    place: Key
    type: string | string[]
    me?: string
    text?: string
    says?: string
    open?: string
    show?: 'dot'
    where?: { [field: string]: string | number | boolean }
    by?: Key
    popup?: boolean
  }

  /** The whole API: the site's own space, its app's instances, and HyperBrowser's services. */
  interface Site extends Place {
    /** An instance of this app (a forum, a conversation), by its key. */
    instance (key: Key): Place
    instances: {
      list (): Promise<Array<{ key: Key, name: string | null, role: string | null, public: boolean }>>
      /** A new instance; public: anyone with its link gets in; private: only people given a role read it. */
      create (name: string, opts?: { public?: boolean, private?: boolean }): Promise<{ key: Key, name: string }>
      join (link: string): Promise<{ key: Key, name: string | null }>
      leave (key: Key): Promise<true>
    }
    /** Needs "contacts" in site.json's permissions, and the person's yes. */
    contacts: {
      me (): Promise<{ identity: Key, name: string | null, findable: boolean }>
      setMe (me: { name?: string, findable?: boolean }): Promise<true>
      list (): Promise<Contact[]>
      request (identity: Key, name?: string): Promise<Contact>
      accept (identity: Key): Promise<Contact>
      decline (identity: Key): Promise<true>
      remove (identity: Key): Promise<true>
      rename (identity: Key, name: string): Promise<true>
      /** A link anyone can use once to become your friend. */
      link (): Promise<{ link: string }>
      add (link: string): Promise<Contact>
      /** The circles you can invite people to (yours, or where you are admin). */
      circles (): Promise<Array<{ key: Key, name: string }>>
      inviteToCircle (identity: Key, circle: Key): Promise<true>
      on (fn: () => void): Unsubscribe
    }
    /** Needs "projects" in site.json's permissions, and the person's yes. Paths are inside the project, with /. */
    projects: {
      list (): Promise<Project[]>
      create (name: string): Promise<Project>
      /** HyperBrowser asks the person to pick the folder: a page never names a path. */
      openFolder (): Promise<Project>
      /** A new project with a copy of a site's pages. */
      openCopy (site: Key): Promise<Project>
      join (link: string): Promise<Project>
      leave (key: Key, opts?: { deleteFiles?: boolean }): Promise<true>
      files (key: Key, opts?: { folders?: boolean }): Promise<ProjectFile[]>
      mkdir (key: Key, path: string): Promise<true>
      /** Built pages (path: html), kept outside the project folder and published with it. */
      build (key: Key, pages: { [path: string]: string }): Promise<true>
      read (key: Key, path: string): Promise<Uint8Array>
      write (key: Key, path: string, data: string | Uint8Array): Promise<true>
      rename (key: Key, from: string, to: string): Promise<true>
      remove (key: Key, path: string): Promise<true>
      publish (key: Key): Promise<{ site: Key, created: boolean, version: number }>
      versions (key: Key): Promise<Array<{ version: number, at: number }>>
      rollBack (key: Key, version: number): Promise<{ site: Key, version: number }>
      /** A draft site of the project, shown beside the page. */
      preview (key: Key): Promise<{ key: Key }>
      resetPreview (key: Key): Promise<{ key: Key }>
      closePreview (): Promise<boolean>
      /** An invite for a co-author. */
      invite (key: Key): Promise<{ link: string }>
      /** The invite sent to a friend, in Chat. */
      inviteContact (key: Key, identity: Key): Promise<true>
      members (key: Key): Promise<Array<{ identity: Key, name: string | null, role: string | null, you: boolean, removed: boolean, banned: boolean, online: boolean }>>
      removeMember (key: Key, identity: Key): Promise<true>
      status (key: Key): Promise<{ devices: number, coauthors: number, git: { branch: string, changed: Array<{ path: string, state: 'new' | 'modified' | 'deleted' }> | null } | null }>
      on (fn: (change: { project: Key }) => void): Unsubscribe
    }
    /** Any site, through HyperBrowser: opening needs a click on the page; a request, the person's yes. */
    people: {
      /** Opens your conversation with them (Contacts, if they are not a friend). false without a click. */
      chat (identity: Key): Promise<boolean>
      contact (identity: Key): Promise<boolean>
      request (identity: Key, name?: string): Promise<Contact>
    }
    /** Needs "notifications" in site.json's permissions. Counts are of this app's instances only. */
    notifications: {
      /** The instance this page shows (null: none): it is not notified, and is marked read. */
      viewing (instance: Key | null): Promise<true>
      unread (): Promise<{ [instance: string]: { count: number, dot: boolean } }>
      on (fn: (unread: { [instance: string]: { count: number, dot: boolean } }) => void): Unsubscribe
      follow (follow: Follow): Promise<{ id: string }>
      unfollow (id: string): Promise<true>
      follows (): Promise<Array<Follow & { id: string, popup: boolean }>>
    }
    circles: {
      /** Asks the person to join a circle (a click on the page first). The page learns only whether they did. */
      join (link: string, name?: string): Promise<{ joined: boolean }>
    }
    /** Apps by their key: installing asks the person, opening needs a click. */
    apps: {
      installed (key: Key): Promise<boolean>
      install (key: Key): Promise<boolean>
      open (key: Key): Promise<boolean>
    }
  }
}

interface Window {
  /** The site API: only in HyperBrowser, for a site whose site.json asks for "space". */
  hyper?: Hyper.Site
}
