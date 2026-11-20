# M17: a calmer, more finished product

**Status:** requested by the product owner on 20 November 2026: messages shouldn't feel like system errors; it should feel clean and self-explanatory, like Google Workspace. Also requested: profile pictures, logos for TeamHappi and for each organisation, and how-to guides for organisations and staff.

## Messages

- **Confirmations** ("Saved", "Invitation sent") are short notes at the bottom of the screen that fade away (`notify`, `reloadWithNote` in `src/components/ui/toast.tsx`), not green boxes on the page. Forms that reload after saving carry the note across the reload.
- **Problems** are one calm line beside the form (`FormError`), plus any field problems. There are no "There's a problem" or "That didn't work" headings, and nothing red and boxed. In the main settings forms the first field with a problem gets focus, and each field shows its own message.
- **Error pages** say what happened in plain words ("This page didn't load", "We can't find that page") and offer a way back. The support code is small and only there for TeamHappi support.
- Internal wording is removed from screens: milestone codes, and the unused "planned module" page.
- Not yet converted: the Platform Admin console (TeamHappi staff only) still uses the older boxes.

## Pictures and logos

| | Who changes it | Who sees it |
|---|---|---|
| **Profile photo** | The person (My profile), or someone with `employee.manage` at their site (the person's Edit page) | Everyone in the same organisation |
| **Organisation logo** | Owners and administrators (Settings › Organisation) | Everyone in the organisation, in the top bar |
| **TeamHappi logo** | TeamHappi staff with integration rights and a recent authenticator check (Platform Admin › Settings) | Everyone, including on sign-in and in Help |

- Pictures are resized in the browser before upload: photos to a 256 px square, logos to at most 512 × 256.
- The server then checks the real file type from its bytes: PNG, JPEG or WebP only, never SVG; at most 300 KB.
- They're stored in the database (`media_image` for organisations, `platform_setting 'brand.logo'` for TeamHappi), so they work without file storage being switched on. That's a few KB each, so it's well within the free tier.
- Photos are personal data: they can be removed, and they're served only to people in the same organisation, with private caching. Changes are audited, with ids only.

## Help centre

`/help` is open to everyone, signed in or not. It has a search box and 13 guides: 9 for owners and managers, 4 for staff. It's reached from the sidebar, the account menu and My profile. The content is in `src/features/help/articles.ts`; keep it in step with the screens.

## Database (add-only)

Migration `20261118120000_profile_photos_and_logos`:
- one new table, `media_image`, with RLS (enabled and forced, plus a policy) and composite keys;
- the database itself checks the picture type and size;
- one photo per person, and one logo per organisation;
- the app role can SELECT, INSERT and DELETE (a photo can be removed), but not UPDATE.
