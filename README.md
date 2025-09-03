# ChatTalk v3

Paid chat with manual UPI approval and per-minute billing.

## Run locally

```bash
npm install
npm start
```

- Client: http://localhost:3000/
- Admin: http://localhost:3000/admin  (PIN: 2103)

## Config
- Per-minute rate: change `RATE_PER_MIN` in `server.js`.
- Minimum recharge: change `MIN_RECHARGE` in `server.js`.
- UPI ID: change `UPI_ID` in `server.js`.
