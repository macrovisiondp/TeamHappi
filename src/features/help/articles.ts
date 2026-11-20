// Help centre content (M17). Plain guides for organisations and their staff,
// written to match the screens. Keep wording in step with the app when screens
// change (labels in quotes are the exact button or field names).

export type Audience = "managers" | "staff";

export interface HelpSection {
  heading: string;
  /** Short paragraphs. */
  text?: string[];
  /** Numbered steps. */
  steps?: string[];
  /** Useful tips, shown as a bulleted list. */
  tips?: string[];
}

export interface HelpArticle {
  slug: string;
  title: string;
  audience: Audience;
  summary: string;
  sections: HelpSection[];
}

export const HELP_ARTICLES: HelpArticle[] = [
  // --- For owners and managers ----------------------------------------------------------
  {
    slug: "getting-started",
    title: "Setting up your organisation",
    audience: "managers",
    summary:
      "The first things to do after your TeamHappi organisation is created.",
    sections: [
      {
        heading: "Before you start",
        text: [
          "TeamHappi creates your organisation and emails the owner an invitation. Open the link, choose a password, and you'll land on your Dashboard.",
          "The Dashboard has a Get started checklist. Each step ticks itself off when it's done, so you can always see what's left.",
        ],
      },
      {
        heading: "The order that works best",
        steps: [
          "Settings › Organisation: check your organisation's name and time zone, and upload your logo.",
          "Settings › Sites: add each restaurant, bar or venue.",
          "Settings › Job titles: add the job titles you use, exactly as your training and onboarding plans use them.",
          "Settings › Teams (optional): for example Front of House and Kitchen.",
          "People: add your staff records, then invite your managers so they can run their sites.",
          "Onboarding › Documents: upload your contracts and policies, and make starter packs.",
          "Training › Courses: add or import your courses, and say who needs each one.",
        ],
      },
      {
        heading: "Good to know",
        tips: [
          "Owners and administrators can change settings. Site managers see and manage only their own sites.",
          "Everything is private to your organisation. Other organisations on TeamHappi can never see your data.",
        ],
      },
    ],
  },
  {
    slug: "people-and-invitations",
    title: "Adding people and inviting them",
    audience: "managers",
    summary:
      "Staff records, job titles, and giving people their own TeamHappi login.",
    sections: [
      {
        heading: "Add a person",
        steps: [
          "Go to People and choose “Add person”.",
          "Enter their name, job title, site and start date. The job title decides their training and onboarding, so pick it from the list.",
          "Save. They now have a staff record, but no login yet.",
        ],
      },
      {
        heading: "Invite them to TeamHappi",
        steps: [
          "Open their record and choose to invite them. They'll get an email with a link.",
          "When they accept, their login is linked to their record. From then on they see their own shifts, documents and training.",
        ],
        tips: [
          "Invitations expire after a few days. You can send a new one from their record.",
          "Managers are invited from Settings › Members, where you also choose their role and sites.",
        ],
      },
      {
        heading: "Profile photos",
        text: [
          "People can add their own photo from My profile. Managers can add or remove a photo from a person's record (Edit). Photos are only visible inside your organisation.",
        ],
      },
    ],
  },
  {
    slug: "new-starter",
    title: "Taking on a new starter",
    audience: "managers",
    summary:
      "From offer letter to first shift: everything a new starter needs to do, in order.",
    sections: [
      {
        heading: "1. Send the offer",
        steps: [
          "In Recruitment, open the application and move it to Offer.",
          "Upload the offer letter as a PDF and send it. The applicant gets a private link to read and accept it, signing with their typed name.",
          "You'll see when they accept or decline. A signed copy is kept with the application.",
        ],
      },
      {
        heading: "2. Hire",
        text: [
          "Hiring creates their staff record with the job title from the vacancy. If you've set up starter packs, the policies for their job title are sent to them automatically, along with an invitation to TeamHappi.",
        ],
      },
      {
        heading: "3. Before their first shift",
        steps: [
          "Right to work: record the check in Onboarding › Right to work. Never type share codes or passport numbers into TeamHappi.",
          "Contract: send their contract from their record. They sign it, then you countersign.",
          "Policies: they read and sign each one on their phone.",
          "About you: they add their address, date of birth and emergency contact.",
          "Training: courses for their job title appear in their My training straight away.",
        ],
      },
      {
        heading: "Keep track",
        text: [
          "Onboarding shows each new starter's progress, and what's overdue. When everything's done, they're cleared to start.",
        ],
      },
    ],
  },
  {
    slug: "documents-to-sign",
    title: "Contracts and policies to sign",
    audience: "managers",
    summary:
      "Upload documents once, send them to the right people, and keep signed copies.",
    sections: [
      {
        heading: "Upload your documents",
        steps: [
          "In Word, save each contract or policy as a PDF (File › Save As › PDF).",
          "Go to Onboarding › Documents and upload it to your library, choosing whether it's a policy or a contract.",
        ],
      },
      {
        heading: "Starter packs",
        text: [
          "A starter pack is a set of policies for a job title, or for everyone. At hire, TeamHappi sends every policy in the packs that match the person's job title.",
        ],
        steps: [
          "In Onboarding › Documents, create a pack: give it a name, choose a job title (or leave it for everyone), and tick the policies.",
        ],
      },
      {
        heading: "Contracts",
        text: [
          "Contracts are sent to one person at a time, from their record. After they sign, you countersign. Both of you can download the signed copy, which includes a page recording who signed and when.",
        ],
      },
      {
        heading: "Updating a document",
        text: [
          "Upload the new version as a new document and archive the old one. People who signed the old version keep their signed copy.",
        ],
      },
    ],
  },
  {
    slug: "training",
    title: "Training courses and who needs them",
    audience: "managers",
    summary:
      "Courses, rules by job title, interactive courses, practical sign-off and certificates.",
    sections: [
      {
        heading: "Courses",
        text: [
          "A course can be read and confirmed, given in person, done with an outside provider (with a certificate), or an interactive course imported from a course file.",
        ],
      },
      {
        heading: "Say who needs a course",
        steps: [
          "Open the course in Training › Courses.",
          "Under “Add a rule”, choose everyone, a site, a job title, or one named person, and whether it's mandatory.",
          "TeamHappi works out who needs what automatically, including new starters and people who change job.",
        ],
      },
      {
        heading: "Interactive courses",
        steps: [
          "In Training › Courses, use “Import interactive courses” to upload course files from your training supplier.",
          "Staff work through the modules on their phone. Each module has a short quiz, and there's a final assessment. Every safety question must be right to pass.",
          "If the course needs a practical sign-off, it shows under “Awaiting practical sign-off” on the course page. Sign it off once you've seen them do it.",
          "A pass gives a TeamHappi certificate, which the person and their managers can download.",
        ],
      },
      {
        heading: "Cover on every shift",
        text: [
          "Tick “Needed on every shift” on a course such as first aid. The rota then warns you when people are working but nobody on shift holds it.",
        ],
      },
      {
        heading: "Recording outside training",
        text: [
          "For courses done elsewhere, open the person's Training page and record the completion date and certificate details.",
        ],
      },
    ],
  },
  {
    slug: "rota",
    title: "Building and publishing the rota",
    audience: "managers",
    summary: "Plan the week, check the warnings, and publish it to your team.",
    sections: [
      {
        heading: "Plan the week",
        steps: [
          "Go to Rota and choose the site and week.",
          "Add shifts, or copy last week's to save time.",
          "Assign people. TeamHappi warns you about clashes, rest breaks, long weeks, missing training and right-to-work checks.",
        ],
      },
      {
        heading: "Publish",
        text: [
          "Staff can't see a week until you publish it. When you do, they're told about their shifts, and later changes are flagged to them.",
        ],
      },
      {
        heading: "Requests from staff",
        tips: [
          "Staff can ask to take open shifts, and ask to drop or swap theirs. You approve or decline each request on the rota.",
        ],
      },
    ],
  },
  {
    slug: "timesheets",
    title: "Clocking in and approving timesheets",
    audience: "managers",
    summary:
      "See who's in, fix mistakes, approve the week and export the hours.",
    sections: [
      {
        heading: "During the week",
        text: [
          "Attendance shows who's clocked in at each site. Times are recorded to the minute and never rounded. You can correct a time with a reason; the original is kept.",
        ],
      },
      {
        heading: "Approve the week",
        steps: [
          "Once the week has ended and nobody is still clocked in, open Attendance › Timesheets.",
          "Check the flags (for example no break recorded, or far from the rota) and fix anything that's wrong.",
          "Approve. The week is then locked. If you need to change it, reopen it with a reason.",
        ],
        tips: [
          "Nobody approves a week that includes their own hours. An owner or another manager approves it.",
        ],
      },
      {
        heading: "Export for payroll",
        text: [
          "Owners, administrators and HR can export approved hours (no pay) for any period, for example a fortnight, from Attendance › Export.",
        ],
      },
    ],
  },
  {
    slug: "recruitment",
    title: "Vacancies and applications",
    audience: "managers",
    summary:
      "Advertise a role, review applicants, interview and make an offer.",
    sections: [
      {
        heading: "Advertise",
        steps: [
          "In Recruitment, create a vacancy with the job title the person will have once hired.",
          "Create a share link and post it wherever you advertise. Applicants apply from the link without an account.",
        ],
      },
      {
        heading: "Review and interview",
        text: [
          "Move each application through the stages, add notes, and schedule interviews. When you're ready, make an offer (see Taking on a new starter).",
        ],
      },
    ],
  },
  {
    slug: "settings",
    title: "Settings, roles and your logo",
    audience: "managers",
    summary:
      "Your organisation's details, logo, job titles and who can do what.",
    sections: [
      {
        heading: "Your logo",
        text: [
          "Settings › Organisation › Logo. A wide logo on a plain or transparent background works best. Everyone in your organisation sees it at the top of TeamHappi.",
        ],
      },
      {
        heading: "Job titles",
        text: [
          "Once you've added your job titles in Settings › Job titles, every job-title box becomes a choice from the list, so a typo can't stop someone getting their training or onboarding.",
        ],
      },
      {
        heading: "Roles",
        tips: [
          "Owner and Administrator: everything, including settings.",
          "HR manager: people, onboarding, training and documents across all sites.",
          "Site manager: their own sites' people, rota and timesheets.",
          "Worker: their own shifts, documents and training only.",
        ],
      },
    ],
  },

  // --- For staff -------------------------------------------------------------------------
  {
    slug: "first-day",
    title: "Getting started with TeamHappi",
    audience: "staff",
    summary:
      "Accept your invitation, sign in, and put TeamHappi on your phone.",
    sections: [
      {
        heading: "Accept your invitation",
        steps: [
          "Open the email from TeamHappi and tap the link.",
          "Choose a password. You're now signed in.",
          "If the link has expired, ask your manager to send a new one.",
        ],
      },
      {
        heading: "Put it on your phone",
        tips: [
          "iPhone: open TeamHappi in Safari, tap Share, then “Add to Home Screen”.",
          "Android: open it in Chrome, tap the menu, then “Install app” or “Add to Home screen”.",
        ],
      },
      {
        heading: "Your profile",
        text: [
          "Tap your name at the top, then My profile, to add a photo and find your shifts, training and documents.",
        ],
      },
    ],
  },
  {
    slug: "shifts-and-clocking",
    title: "Your shifts and clocking in",
    audience: "staff",
    summary: "See your rota, clock in and out, and ask for changes.",
    sections: [
      {
        heading: "Your shifts",
        text: [
          "My shifts shows your upcoming shifts once your manager publishes the rota. Changes are highlighted so you don't miss them.",
        ],
      },
      {
        heading: "Clocking in",
        steps: [
          "When you arrive, open My shifts and tap “Clock in”.",
          "Tap “Start break” and “End break” for your breaks.",
          "Tap “Clock out” when you finish.",
        ],
        tips: [
          "Forgot to clock in or out? Tell your manager; they can correct it.",
        ],
      },
      {
        heading: "Changing a shift",
        text: [
          "You can ask to drop a shift or swap it with a colleague, and ask to take open shifts. Your manager approves each request.",
        ],
      },
    ],
  },
  {
    slug: "documents-and-details",
    title: "Signing documents and your details",
    audience: "staff",
    summary: "Read and sign your contract and policies, and add your details.",
    sections: [
      {
        heading: "Documents to sign",
        steps: [
          "Open My profile › My documents and details.",
          "Open each document, read it, and sign by typing your name.",
          "You can download a signed copy at any time.",
        ],
      },
      {
        heading: "About you",
        text: [
          "Add your home address, date of birth and an emergency contact. Only you and HR can see them; your manager sees your emergency contact.",
        ],
      },
    ],
  },
  {
    slug: "my-training",
    title: "Doing your training",
    audience: "staff",
    summary:
      "Work through your courses, pass the assessment and get your certificate.",
    sections: [
      {
        heading: "Find your courses",
        text: [
          "My training lists the training your workplace asks you to do, with due dates. Mandatory courses are shown first.",
        ],
      },
      {
        heading: "Interactive courses",
        steps: [
          "Tap “Open the course” and work through each module.",
          "Each module ends with a short quiz. You see the explanations after you submit, and you can try again.",
          "When every quiz is passed, the final assessment unlocks. Every safety question must be right to pass.",
          "If the course has a practical part, your trainer signs it off after watching you.",
          "When you've passed, download your certificate from My training.",
        ],
      },
    ],
  },
];

export const articleBySlug = (slug: string) =>
  HELP_ARTICLES.find((a) => a.slug === slug) ?? null;
