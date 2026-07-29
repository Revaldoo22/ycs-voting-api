# Participant verification by contact (WhatsApp / email)

A trigger endpoint that marks a participant as **verified** by looking them up
via their **WhatsApp number or email**, and returns their data together with
their **referral link**. Built for automations (a WhatsApp bot, an email
webhook) or an admin action.

Source: `backend/src/participants/` — `verify-by-contact.dto.ts`,
`participants.service.ts#verifyByContact`, `participants.controller.ts`.

---

## Endpoint

```
POST /api/events/:eventId/participants/verify-by-contact
```

- **Auth:** Bearer JWT + permission `participants.verify` (same as the existing
  admin verify actions). Scoped to the event by `EventScopeGuard`.
- **Why event-scoped:** email/phone are unique *within an event*, not globally.
  The `:eventId` disambiguates and matches how the rest of the participants API
  is mounted.

### Request body

```json
{ "contact": "081234567890" }
```

| Field     | Type   | Notes                                            |
|-----------|--------|--------------------------------------------------|
| `contact` | string | A WhatsApp number **or** an email. Required.     |

`contact` is treated as an **email** when it contains `@`, otherwise as a
**phone number**.

### Success response (`201`)

```json
{
  "message": "Peserta Budi Santoso berhasil diverifikasi.",
  "alreadyVerified": false,
  "participant": {
    "id": 42,
    "fullname": "Budi Santoso",
    "email": "budi@mail.com",
    "phone": "081234567890",
    "status": "verified",
    "registrationStep": "review",
    "referralCode": "a1b2c3d4",
    "referralValidCount": 0
    // …other participant fields; `password` is never included
  },
  "referral": {
    "code": "a1b2c3d4",
    "link": "https://app.example.com/ycs-2026/daftar?ref=a1b2c3d4"
  }
}
```

- `alreadyVerified` is `true` when the participant was already
  verified/shortlisted/selected/attended — the call is then a **no-op** (status
  unchanged) and `message` reads `"… sudah terverifikasi sebelumnya."`.
- `referral.link` is `<APP_URL>/<eventSlug>/daftar?ref=<referralCode>`, where
  `APP_URL` comes from the backend env (`backend/src/config/env.ts`).

### Not found (`404`)

Clear Indonesian message, e.g.:

```json
{
  "statusCode": 404,
  "message": "Peserta dengan nomor WhatsApp \"081234567890\" tidak ditemukan pada event ini."
}
```

(Says `email` instead of `nomor WhatsApp` when the input looked like an email.)

---

## Lookup rules

**Email** — matched case-insensitively (`ILIKE`), input trimmed.

**WhatsApp number** — Indonesian numbers are stored in different shapes
(`0812…`, `62812…`, `+62812…`). The lookup normalizes the input to digits and
searches every equivalent form, so any of these find the same participant:

| Input          | Also matches                          |
|----------------|---------------------------------------|
| `081234567890` | `6281234567890`, `+6281234567890`     |
| `6281234567890`| `081234567890`, `+6281234567890`      |
| `+62 812-3456-7890` | all of the above                 |

---

## Behavior when registration isn't finished yet

The trigger may fire **before** a participant completes the registration wizard
(e.g. a Google sign-in that stopped at the profile step). It still works, and —
critically — the participant **stays verified** afterwards.

This is guaranteed by three coordinated rules:

1. **Referral link always exists.** A `referralCode` is generated the moment the
   account is created (even a draft), so it is always returnable.

2. **The wizard is gated on progress, not status.**
   `ParticipantAuthService.loadDraft` treats registration as "in progress" while
   `registrationStep !== 'done'`. A force-verified draft (`status: 'verified'`,
   step not yet `done`) can therefore still run the remaining steps and confirm.

3. **Completing registration does not downgrade the status.**
   `confirmRegistration` keeps a pre-verified participant at `verified` instead
   of flipping them back to `registered`.

### Status lifecycle

```
draft ──(trigger)──► verified ──(participant finishes wizard)──► verified ✅
                                          (NOT back to "registered")

draft ──(participant finishes wizard)──► registered ──(trigger/admin)──► verified
```

### Referral attribution stays correct

Verification is applied through `updateStatus`, which emits
`participant.status_changed`; `ReferralService` credits the referrer when the
invitee crosses the event's `referralValidOn` threshold. To avoid double
counting, `handleRegistered` **skips** re-crediting a referrer when the invitee
is already beyond `registered` (i.e. was verified early). Net effect: a referred
invitee counts **exactly once**.

---

## Idempotency & edge cases

- **Already verified / further along** → no status change, no events emitted,
  `alreadyVerified: true`. Safe to call repeatedly.
- **`rejected` / `flagged`** → the trigger moves them to `verified` (it is an
  explicit verify action).
- **Password field** is stripped from every response.
- **Not found** → `404` with the Indonesian message above (never a 500).

---

## Examples

```bash
# By email
curl -X POST "https://app.example.com/api/events/7/participants/verify-by-contact" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "contact": "budi@mail.com" }'

# By WhatsApp number
curl -X POST "https://app.example.com/api/events/7/participants/verify-by-contact" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "contact": "081234567890" }'
```

The referrer's shareable link comes back in `referral.link` — hand it straight
to the participant over WhatsApp/email.
