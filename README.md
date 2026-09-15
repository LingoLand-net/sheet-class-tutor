# Class Companion

Build a tablet-first Language Center LMS app (100dvh, min 48px touch targets for iPad/Android) backed by Google Sheets (Tabs: GROUPS, STUDENTS, ENROLLMENTS, ATTENDANCE). Include an admin padlock toggle with a numeric keypad modal to unlock via PIN (1234), and 3 primary tabs: 1) Session Roll Call with group picker, student cards with Present/Absent and Payment toggles, and batch Save All; 2) Group Moderator to create, edit, and archive/activate class groups; 3) Student Registry + Ledger to register students, track balances, and inspect individual attendance/payment timeline history. Implement Google Sheets API v4 integration with local/in-memory caching and fallback sample data when keys are pending.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/28444428-1eb0-4911-8cfa-0d347a5e83b9).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
