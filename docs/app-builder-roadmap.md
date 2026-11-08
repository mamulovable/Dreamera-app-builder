# AppForge: App Builder Roadmap

## Done

- **Chapter 1: Home Screen Layout.** Header, prompt composer, projects section (placeholder data).
- **Chapter 2: Auth + DB Setup.** CloudHike Auth, `users` table with free signup credits.
- **Chapter 5 + 6 (first pass): AppForge Agent.** OpenAI Agents SDK on CloudHike AI (`lib/agent/`). The agent starts on its own when the workspace opens, proposes a screen plan in the chat (`propose_plan`), revises it from chat feedback, and builds the screens one at a time after confirmation (button or `confirm_plan` in chat). Everything streams from `POST /api/projects/[id]/agent` as NDJSON events.

- **Screen building and live preview.** After confirmation the agent generates a foundation (a theme package and shared sample data), then builds the screens one at a time. See "How generated apps run" below.
- **Chapter 8 (first pass): Edit by chat.** Once an app is built, the agent changes it from chat: `update_app` adds, edits, renames, and removes screens, picks the screen the app opens on, and adds to its data, and `set_theme` switches or adds themes. Changes run as a normal build (`lib/agent/changes.ts`, tracked in `plan.pendingChanges`), and only the affected screens are regenerated. An edited screen keeps running its old code until the new code is ready. Version history isn't built yet.

- **Chapter 10 (first pass): Export and sharing.** `lib/generated-app/export-project.ts` turns an app into a complete Expo project, which the ZIP download and GitHub push both send. Its dependency versions come from `bundledNativeModules.json` in expo@54, so moving to a new SDK means updating them along with `SNACK_SDK_VERSION`. A project's first push goes to the default branch only if the repository is empty, and every other push goes to a new `appforge/...` branch, so nothing already on GitHub is overwritten (`lib/github/push.ts`). Sharing is per person and view-only: the owner adds an existing account by email, and `lib/project-access.ts` decides who can open a project. Every route that changes a project still only accepts its owner.

- **Publish.** The Publish button exports `.aab`, `.apk`, or `.ipa` files. Nothing builds on Vercel, see "How publishing works" below.

## How plans and credits work

- **Plans** (`lib/plans.ts`). Every limit and price is defined here, and the pricing page and popups read them from it. Free has 2 projects, 5 screens per project, and no native builds. Pro has unlimited projects, up to 10 screens per project (`MAX_PLAN_SCREENS`), and native builds. ZIP downloads and Push to GitHub aren't limited by plan.
- **Costs.** 10 credits per new screen, 5 per round of changes, and 1 per AI image in edit mode. A small app of 4 screens is 40, which is where "2 small apps and 4 edits" and "25 small apps or 200 edits" come from. Chatting, plans, and theme switches are free, but the agent won't take a message from someone with under 5 credits.
- **Two balances** (`users.credits`, `users.monthly_credits`). `credits` never expires and `monthly_credits` is Pro's, which is spent first. A renewal replaces `monthly_credits`, and ending Pro zeroes it, so Free credits survive both. Refunds go to `credits`.
- **Charging** (`lib/billing/credits.ts`). `chargeForBuild` takes the credits before anything about the build is saved, in one conditional `UPDATE`, so two tabs can't go below zero. The agent's tools check first only so its reply can say why, and the charge decides. Picking up an interrupted build isn't charged again.
- **Failures.** `buildCost` works from what's unbuilt, so a failed build refunds exactly what trying again would charge. Each refund has a unique `reference`, so a retried step can't pay out twice.
- **Ledger** (`credit_transactions`). Every change is a row. `reference` is unique, which is also what makes refunds and renewals idempotent.
- **Stripe** (`lib/billing/stripe.ts`). Everything that depends on the provider is in this file. Checkout starts Pro. Webhooks (`POST /api/billing/webhook`) set the plan from the subscription, which is read again from Stripe because events can arrive out of order. Credits only come from a paid `subscription_create` or `subscription_cycle` invoice. Downgrading sets `cancel_at_period_end`, so Pro lasts until the paid period ends, when the `deleted` event moves the person to Free.
- **Downgraded people** keep their projects and bigger apps, and can edit them, but can't add more than Free allows.
- **Upgrade prompts.** API errors from a limit carry `code` (an `UpgradeReason`), and the agent stream has an `upgrade` event. Both open the same dialog (`components/billing/upgrade-dialog.tsx`).

## How publishing works

- **Flow** (`lib/publish/builds.ts`). `POST /api/projects/[id]/publish` saves an `app_builds` row, makes sure the app has an EAS project, uploads the exported project as a tarball, and starts an EAS workflow run, then returns. EAS does all of the building. GitHub isn't involved, and Push to GitHub stays a separate feature.
- **Expo's API** (`lib/publish/expo.ts`). This uses the GraphQL API behind the EAS CLI, as `eas workflow:run` does, because the documented REST dispatch needs a linked repository and a git ref. It isn't a documented API, so everything depending on its shape stays in this file.
- **Status.** There's no webhook. A build with a run is compared with Expo when someone looks at it (`refreshBuilds`), at most every 15 seconds. The result is saved, so closing the tab loses nothing, but a build only moves on when the dialog is open.
- **Identity** (`project_publishing`). The slug, `android.package`, and `ios.bundleIdentifier` are set once at the first build, with a suffix from the project id, because names change and can repeat. ZIP downloads and pushes use them too, along with `eas.json`. EAS keeps `versionCode` and `buildNumber` (`appVersionSource: remote`).
- **Secrets.** The Expo token is encrypted with `CLOUDHIKE_ENCRYPTION_KEY`, never sent to the browser, and only used from this server.
- **Android signing.** Builds with nobody at a terminal won't create a keystore, so `ensureAndroidKeystore` has Expo generate one and registers it. An app with a keystore is never given a new one.
- **iOS.** Apple credentials can't be made without the person. If EAS has none for the app's bundle id, the dialog shows setup steps instead of starting a build.
- **Web** (`lib/publish/web.ts`, `web_publishes`). Publish as Web uses the same Expo connection and identity, and runs an EAS workflow with a `deploy` job, which exports the app and deploys it to EAS Hosting with `prod: true`. The identity keeps the EAS project, and so the `https://<name>.expo.app` address, the same across publishes. `ensureWebDomain` assigns that name up front, with the person's token, because a deploy from a workflow may not be allowed to. A project has one row, separate from `app_builds`, so an update doesn't wait for a native build. `live_url` only changes when a publish succeeds, since the old version stays online if an update fails. The workspace follows an active publish even with the dialog closed, and the App Preview tab shows the address. Generated apps keep `web.output: "single"`, so screens never have to render in Node. An app's `apiUrl` comes from `NEXT_PUBLIC_APP_URL`, so publish from a deployed AppForge, not localhost, if the app has a backend.

## How the home page lists projects

- **Lists.** Signed-in people see their own projects (`GET /api/projects`) and what's shared with them. Visitors see `GET /api/projects/public`: the 24 most recently edited apps that are public and `ready`, so an app in the middle of a build waits until it's done. It only ever shows the author's name, never an email.
- **Public or private** (`projects.is_public`). Off by default, and only the owner can change it, from the share dialog. It doesn't open the workspace to anyone: it only allows the list and the preview route.
- **Previews.** There are no stored screenshots: a card runs the app itself in the same sandboxed frame as the workspace, not tappable, so it always shows the latest screens. Each frame is a whole running app, so a card loads its app when it gets near the screen and stops it once it's scrolled away.
- **Sample data only.** `GET /api/projects/[id]/preview` removes `plan.backend`, which puts the app on the local provider. Strangers trying an app can't reach the owner's backend, and what they do stays in their browser (`demo:<id>` in localStorage, apart from the workspace's data).
- **Duplicate and delete.** Both wait for the agent to finish. A copy gets the chat, screens, and files, but starts private and without a backend. Deleting removes the project's rows and uploaded files, but not its website, repository, or CloudHike backend, which the dialog says.

## How builds run

- **Planning** still runs in the agent route's process (`lib/agent/runs.ts`). **Screen generation** runs on CloudHike Jobs, one step per run: the foundation, then each screen (`runBuildStep`). Each step queues the next, so a build isn't limited by one run's timeout (5 minutes on Free).
- **Streaming.** Jobs only returns a run's final answer, so the worker (`POST /api/jobs/build-step`) saves batched events to `build_events`, and `POST /api/projects/[id]/agent` streams them to the browser as the same NDJSON as before. It works across processes, and a browser that reconnects gets a replay from the start of the build.
- **Duplicates and retries.** Jobs delivers at least once. A delivery of an earlier step is ignored (`builds.step`). A retry of the current step takes over `builds.lease`, which stops the older execution at its next write.
- **Failures.** While a browser is following a build, it checks the Jobs run every 10 seconds, and fails the build if the run failed or the chain stopped. A build nobody is watching shows as building until the workspace is opened again.
- **Local development.** Jobs refuses localhost, so set `JOBS_PUBLIC_URL` to a tunnel to the dev server.

## How generated apps run

- **Preview runtime** (`preview-runtime/`, bundled by `scripts/build-preview-runtime.mjs` before `dev` and `build`). Generated Expo code runs on `react-native-web` in a frame sandboxed without `allow-same-origin`, because it's AI-generated code and must not reach this site's cookies or storage. It talks to the workspace through `lib/preview-protocol.ts`.
- **Themes** (`lib/themes.ts`). Screens only use tokens from `@/theme`, and `lib/agent/validate-screen.ts` sends back any screen with literal colors. In the preview, tokens are CSS variables, so a theme switch only sets those variables. In the Expo app, it only changes `activeThemeId` in `theme/themes.ts`.
- **Backend** (`lib/generated-app/project-files.ts`). Screens only use the hooks from `@/lib/backend`, which sit on the `BackendProvider` interface. An app starts on the local provider, and the preview keeps its data in the workspace's localStorage. Once it has a CloudHike backend, `lib/backend/config.ts` switches it to `lib/backend/cloudhike.ts`. No screen changes.
- **Shared components** (`lib/agent/components.ts`). After the foundation, one step writes the library of reusable components (`components/<Name>.tsx`), and screens import them from `@/components/<Name>`. They only draw what they're given as props, and only the tab bar navigates, so they can't reach the backend. A component only imports ones listed before it, so imports can't form a circle. Chat edits go through `update_app`'s `addComponents` and `editComponents`: one step per component (`pendingChanges.components`), with no screen rewritten, and a component that doesn't come out right keeps its old code. Stored in `projects.plan.components`. Apps built earlier have none, and start using them when the agent adds one.
- **Inline editing.** The Edit icon on a canvas screen puts its frame in edit mode, where a click picks an element instead of pressing it (`preview-runtime/inspector.ts`). Every rendered element is stamped `data-af-source="<file>:<line>:<type>"` when the code is compiled, because the compiler gives no column. Two of the same type on one line can't be told apart, so those only take edits through the AI. An edit reaches every frame as an override on top of the running code, which re-renders only that element and never restarts the app. Shortly after, `lib/element-source.ts` splices it into the source and `PUT /api/projects/[id]/files` saves it. Frames keep running the code they compiled until the agent changes the file or the page reloads, so their stamps stay valid, and each save re-applies all edits to that same base (`hooks/use-inline-editor.ts`). The selected element goes to the agent with the chat message as a `<selected-element>` block saved in the message. Custom colors are literal values, which don't follow theme switches. Validation keeps colors already in the file or named in the request, while the agent's other colors must still be tokens.
- **Shared tab layout** (`lib/generated-app/project-files.ts`). Each tab in a plan has `screen.tab` (a label and an Ionicons name). Tab screens live in `app/(tabs)/`, which doesn't change their routes, and `app/(tabs)/_layout.tsx` is generated from the plan, so adding or renaming a tab rewrites no screen. The web preview draws the bar itself and Snack uses `@react-navigation/bottom-tabs`. Tab apps built before this have no `screen.tab` and keep drawing the bar in each screen.
- **On a real device** (`lib/generated-app/snack-project.ts`, `hooks/use-expo-snack.ts`). Scan QR Code puts the app online as an Expo Snack on SDK 54, from the browser tab, so it stays online until the tab closes. Every code change, including inline edits, goes straight to connected phones. Snack has no path aliases and runs generated apps more reliably on React Navigation, so imports become relative, `App.js` replaces `app/_layout.tsx`, and "expo-router" becomes a small file on top of React Navigation. `router.replace` doesn't animate there, as in the web preview, because tab bars switch with it and a slide makes each tab look like a new page. Screens and the web preview don't change. It needs Expo Go for SDK 54: newer versions refuse the app, and the published `snack-sdk` doesn't go past 54 yet.
- **Images** (`lib/imagekit.ts`, `app/api/projects/[projectId]/images/route.ts`). A selected image can be replaced, generated, or transformed from a prompt in edit mode. The server waits for ImageKit's AI to finish before the app gets a url, since a phone can't show ImageKit's "still preparing" page. A generated image stays at its generation url, and a transformed one is saved as its own file in `/appforge/<projectId>`. The new url is a normal inline edit, so it shows in the frames at once, and is saved in the screen's code without regenerating anything. Images that come from an app's data aren't changed this way. With `IMAGEKIT_ENABLED=true` and both keys set, the agent also writes ImageKit's generation url (`<endpoint>/ik-genimg-prompt-<description>/<name>.jpg`) where an image goes. The build moves it to the project's folder, signs it, and waits for the image before saving, up to 8 per build step, with placeholders past that or on failure. Otherwise agents use placeholder images and edit mode only has the image url field.
- **Stored in** `projects.plan` as `themePackage` and `collections`, so no migration is needed. Projects built earlier have neither: they still run, but with their own colors and no theme switcher, until rebuilt.

## How CloudHike backends work

- **Connecting** (`/api/projects/[id]/backend/connect`, `/api/cloudhike/callback`). The Connect Backend dialog sends the browser to CloudHike's `/connect`. A random `state` in an HttpOnly cookie ties the callback to that browser and project. The access token is one per person (`cloudhike_connections`), and each app has its own row in `project_backends`. Tokens and project credentials are encrypted with `CLOUDHIKE_ENCRYPTION_KEY`.
- **Deploying** (`setUpBackend` in `lib/cloudhike/backend.ts`). Runs from the agent's `setup_backend` tool and on its own at the end of any build of a connected app. Each app gets its own CloudHike project. It always deploys Postgres, and adds Auth or Storage when the screens' code uses `useAuth` or `uploadFile`. It's safe to repeat, because it only adds what's missing.
- **The agent never touches CloudHike MCP directly.** `lib/cloudhike/client.ts` calls MCP's `create_project` and `deploy_services` from server code. Raw MCP tools would let the model read secrets through `get_environment` and reach the person's other projects. Status and the .env come from the REST API, whose formats are documented.
- **The app's data** (`/api/apps/[id]/...`, `lib/cloudhike/gateway.ts`). Apps can't hold database or storage credentials, and CloudHike Functions isn't available yet, so this site answers for them. When Functions launches, this is what moves there.
- **The app's tables** (`lib/cloudhike/app-schema.ts`). In the person's own database, each collection is an `app_<name>` table with `id`, `owner_id`, timestamps, and a typed column for each field (`string` is `text`, `number` is `double precision`, `boolean` is `boolean`, `string[]` is `text[]`). A field with `references` gets a foreign key that empties when the record it points to is deleted. Saved values (`useStoredValue`) are in `appforge_values`, the only JSON column, since a value can be anything. A write with an unknown field or a value of the wrong type is refused with a 400, so nothing is silently lost.
- **Keeping tables up to date** (`prepareAppDatabase`). Runs in one locked transaction from `setUpBackend`, and from the first data request in each process after the plan's collections change. Tables and columns are only added: removing a field from a plan leaves its column. Apps from before tables existed have their records moved from `appforge_records`, which is then renamed `appforge_records_legacy` and kept as a backup. Only `apiPath`, `authUrl`, and the publishable `authKey` ship inside the app (`plan.backend`).
- **Who sees what.** A record's owner is the signed-in person (the token is checked with the project's Auth), or else one install, by a random id. Collections are private to their owner unless `shared`, and only an owner can change a record. Email only goes to the signed-in person's own address. Jobs and Redis deploy, but apps can't use them until there's server code to call them.
- **Sync.** Screens load their records when they open. Only preview frames poll, every 5 seconds, and only while the agent is building or changing screens. Writes need a connection: there's no offline queue.
- **Local development.** Open the workspace at `NEXT_PUBLIC_APP_URL`, since that's where the state cookie has to be, and register that exact callback URL in CloudHike.

## Planned Chapters

### Chapter 3: Project Creation + Save to Database
Covers the data and API side only. No new UI pages.

1. **Schema**
   - `projects`: id, userId, title, prompt, platform, status (`planning` | `building` | `ready` | `failed`), createdAt, updatedAt
   - `messages`: id, projectId, role (`user` | `assistant`), content, createdAt
2. **API**
   - `POST /api/projects`: check the session, insert the project and its first user message, return the id
   - `GET /api/projects`: list the signed-in user's projects
   - `GET /api/projects/[id]`: one project with its messages (owner only)
3. **Prompt composer** ([prompt-composer.tsx](../components/home/prompt-composer.tsx) TODO): if the user is signed out, open sign-in. Otherwise call `POST /api/projects` and go to `/project/[id]`.
4. **Home projects section** ([projects-section.tsx](../components/home/projects-section.tsx) TODO): replace the `lib/home-data.ts` placeholders with real projects.

### Chapter 4: Workspace Layout (`/project/[id]`)
UI only, with no AI yet.

- Resizable two-panel layout (`react-resizable-panels`)
  - **Left:** chat panel that shows the project's messages, plus an input box
  - **Right:** tabs for **Preview** (phone frame, empty state for now) and **Code** (empty for now)
- Workspace header: project title, back to home, credits
- Loading, not-found, and not-your-project states

### Chapter 5: AI Planning Step (Screen Selection)
See the decision below. The AI reads the prompt and proposes a list of screens. The user selects or deselects them, then confirms.

### Chapter 6: AI Generation Agent
Generate code only for the selected screens, one screen at a time. Stream progress into the chat, save the generated files to the DB, and deduct credits.

### Chapter 7: Live Preview + Code Viewer
Render the generated app inside the phone frame (Expo Snack or React Native Web sandbox). Show the files in the code tab with `shiki` / `code-block`.

### Chapter 8: Edit by Chat
Follow-up prompts change existing files. Keep version history and allow restoring an earlier version.

### Chapter 9: Credits + Billing
Show the credit balance, block generation at zero credits, add a pricing/checkout page.

### Chapter 10: Export + Deploy
Download a zip, open the app in Expo Go with a QR code, create a shareable link.

---

## Decision: Show the Screen Plan First, or Generate Directly?

**Recommendation: show the plan first.** Display the proposed screens as a selectable grid before generating any code.

### Why

- **Saves credits and money.** Planning is one small, cheap LLM call. Full generation is expensive. Building screens the user didn't want wastes both.
- **Sets expectations.** The user sees what will be built before waiting for it.
- **Better generation quality.** A confirmed screen list gives the agent a clear structure. It can generate screen by screen and show real progress ("Building 3/6: Profile").
- **Fewer correction loops.** It's cheaper to fix a plan than to regenerate code.
- **Same approach as other tools.** Plan-then-build is a common pattern in AI builders.

### How to keep it low-friction

- All screens are **preselected**. A user who doesn't want to customize just clicks **Build**.
- Each card shows: screen name, a one-line description, and an icon or simple wireframe.
- Allow **Add custom screen** and editing a screen's name or description.
- Mark required screens (for example Home) as locked or always on.
- Planning is free or costs very few credits. Show the estimated cost of the build on the Build button.
- Optional later: a "Skip planning" setting for power users.

### Where it lives in the flow

Show the plan **inside the workspace chat**, after the project is created, not on the home screen. That way:

- the plan is saved in the DB (it's refresh-safe and part of the chat history)
- the project `status` can track it: `planning` → `building` → `ready`
- the home screen stays a single prompt box

### Separate plan page vs. inside the workspace

Another option was a separate page before the workspace (`/project/[id]/plan`).

| | Separate plan page | Inside workspace (chosen) |
|---|---|---|
| Space for the grid | Full screen | Large right panel, so still plenty |
| Page changes | Home → Plan → Workspace (2 jumps) | Home → Workspace (1 jump) |
| Plan in chat history | No | Yes ("Here's the plan…") |
| Change the plan by chatting ("add a settings screen") | Hard | Natural |
| Revisit the plan later | Needs a separate route | It stays in the chat |
| Extra work | A new page, routing, and handoff | Reuses the Chapter 4 layout |

**Decision: inside the workspace, using the right panel.**

- While `status = planning`, the **right panel** (where the preview will be) shows the **screen selection grid** in place of the empty phone frame.
- The **left chat** shows the AI message: "I've planned 6 screens for your app. Select the ones you want and click Build."
- After **Build** is clicked, the right panel switches to the build progress and then to the live preview.
- The grid gets the space of a full page, without an extra page.

### Final Flow

```
Home prompt
  → (sign in if needed)
  → Create project + save prompt          [Chapter 3]
  → Open /project/[id] workspace          [Chapter 4]
  → AI proposes screens → user selects    [Chapter 5]
  → Build selected screens, streamed      [Chapter 6]
  → Live preview + code                   [Chapter 7]
  → Iterate by chat                       [Chapter 8]
```
