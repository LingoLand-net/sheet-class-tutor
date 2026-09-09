# Language Center LMS (tablet-first)

A full-screen (100dvh) app designed for iPad/Android tablets, with large touch targets (min 48px), backed by a Google Sheet with four tabs: GROUPS, STUDENTS, ENROLLMENTS, ATTENDANCE.

## Screens

**Top bar** — center name, today's date, and a padlock button. Locked by default: viewing is allowed, editing is not. Tapping the padlock opens a large numeric keypad (0-9, clear, enter) to enter PIN 1234 and unlock admin actions. Tapping again re-locks.

**Tab 1 — Session Roll Call**
- Group picker (big pill buttons or dropdown) listing active groups.
- One card per enrolled student: name, balance, Present/Absent toggle, Paid toggle.
- Quick actions: mark all present, clear.
- "Save All" button writes one attendance row per student for the session date and updates balances.
- Unsaved-changes indicator; save disabled while locked.

**Tab 2 — Group Moderator**
- List of groups with level, schedule, teacher, price, student count, status.
- Create and edit groups in a large form sheet.
- Archive / re-activate toggle; archived groups hidden from roll call.

**Tab 3 — Student Registry + Ledger**
- Searchable student list with balance chips (credit / due).
- Register a new student (name, phone, level, group enrollment, starting balance).
- Tap a student to open their ledger: current balance, attendance rate, and a chronological timeline of attendance and payment entries.

## Data and sync

- Google Sheets API v4 via the Lovable connector gateway, called only from server functions (keys never reach the browser).
- Reads: batched range reads per tab, mapped to typed records.
- Writes: append rows for attendance, update rows for groups/students.
- In-memory cache on the server with a short TTL plus client-side query caching, so tapping between tabs never re-hits the API.
- Fallback: when no Sheets connection is linked, the app runs on bundled sample data (3 groups, ~12 students, recent attendance) and shows a small "Sample data" badge. Everything stays fully usable; writes update the in-memory copy.

## Technical notes

- Routes: `/` (roll call), `/groups`, `/students` — shared tablet shell layout with bottom tab bar sized for thumbs.
- Server functions in `src/lib/sheets.functions.ts`; gateway client + row mappers + sample data in `src/lib/sheets.server.ts`.
- Sheet schema created/expected:
  - GROUPS: id, name, level, teacher, schedule, price_per_session, status
  - STUDENTS: id, name, phone, level, balance, created_at
  - ENROLLMENTS: id, student_id, group_id, status
  - ATTENDANCE: id, date, group_id, student_id, status, paid, amount
- Admin PIN 1234 is a client-side UI gate (as requested), stored in session state only — not a security boundary.
- Design: warm, high-contrast schoolroom palette, large type, rounded cards; all colors as semantic tokens in `src/styles.css`.

## After the build

To connect the real spreadsheet I will open a Google Sheets connection card, then ask for the spreadsheet ID/URL.
