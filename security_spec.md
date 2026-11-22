# Security Specification & Payload-First TDD (`SMPN 2 Ciamis - Portal PJOK`)

## 1. Data Invariants
1. All student PII (`parentWhatsapp`, `parentName`) and full roster/grade/attendance/notification collections (`/students`, `/grades`, `/attendance`, `/notifications`, `/app_config`) are strictly accessible only to verified Admin (`galihcipta22@gmail.com` with `email_verified == true` or registered `/admins/{uid}`).
2. Every document ID in single-document operations (`get`, `create`, `update`, `delete`) must satisfy `isValidId(id)` (`^[a-zA-Z0-9_-]+$`, `<= 128` chars).
3. Every `create` and `update` enforces `isValid[Entity](incoming())`, strict `data.keys().hasAll(...)` + `data.keys().hasOnly(...)` on create, `affectedKeys().hasOnly(...)` on update, bounded `.size()` checks on every string and array, `ownerUid == request.auth.uid`, and server timestamps (`request.time`).
4. `public_portal/{docId}`, `media_assets/{assetId}`, and hashed-NIS `student_reports/{reportId}` contain zero PII (no phone numbers, WhatsApp, emails, addresses) and forbid `list` queries by non-admins (`allow list: if isAdmin();`) to prevent scraping/enumeration.
5. `media_assets/{assetId}` caps `dataUrl.size() <= 480000` to protect Firestore's 1MB document limit and prevent storage abuse.

## 2. The "Dirty Dozen" Payloads (Expected: `PERMISSION_DENIED`)
1. Unauthenticated `list` on `/students`: `allow list` requires `isAdmin()`.
2. Unauthenticated `get` on `/students/{id}` (PII exposure test): requires `isAdmin()`.
3. Email spoofing where `request.auth.token.email == 'galihcipta22@gmail.com'` and `email_verified == false`: rejected by `isAdmin()`.
4. Non-admin authenticated user creating `/admins/{uid}`: rejected by email verification + allowlisted bootstrap email check.
5. Shadow update adding ghost field `isVerified: true` on `/students/{id}`: rejected by `data.keys().hasOnly(...)` / `affectedKeys().hasOnly(...)`.
6. Value poisoning on `/media_assets/{id}` with `dataUrl` exceeding 480KB or invalid `kind: 'exe'`: rejected by `isValidMediaAsset`.
7. Path ID poisoning `/students/../../../etc` or >128 char ID: rejected by `isValidId`.
8. Unauthenticated `list` on `/student_reports`: rejected because `allow list: if isAdmin()`.
9. Unauthenticated `write` on `/public_portal/overview`: rejected because write requires `isAdmin()`.
10. Client-forged `createdAt` or `updatedAt` timestamp != `request.time`: rejected by temporal integrity checks.
11. Modifying immutable `ownerUid` or `createdAt` during update on `/students/{id}`: rejected by `incoming().ownerUid == existing().ownerUid && incoming().createdAt == existing().createdAt`.
12. Out-of-range grade score (`praktikScore: 150` or `-5`) on `/grades/{id}`: rejected by `0 <= score <= 100`.
