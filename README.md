# AstroChat (Firebase Ready)
Single-page app that uses Firebase Firestore for:
- Transactions (pending → approve/reject)
- Wallet balance with ₹10/min auto deduction
- Start/Stop chat with live timer
- Live chat (client ↔ admin), admin PIN 2103

No build tools needed. Just open `index.html` or deploy to GitHub Pages.

## Firestore
The app will create/use these documents/collections:
- `wallet/primary` (field: balance: number)
- `control/state` (field: running: boolean)
- `transactions` (utr, amount, status, timestamps)
- `messages` (sender, message, timestamp)
