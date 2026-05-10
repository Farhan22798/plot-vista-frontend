# Plot Vista — Frontend (React Native)

This folder contains the **Plot Vista** mobile app: a **real-estate master plan and booking workspace** for **Golden City** (master plan map, plot lifecycle, financial views, team chat, and admin tools). It is built with **React Native** and talks to your Plot Vista **backend API**, with **CometChat** for community messaging and **Firebase Cloud Messaging** for push notifications.

The app helps sales and operations teams see every plot on an interactive layout, manage **waiting lists** and **bookings**, track **balances** and **payments**, review **area statements**, and follow an **activity summary** of what changed across the site—optionally mirrored into CometChat notification channels.

---

## Features

### Master plan and plots

- **Interactive master plan** with pinch-to-zoom and pan; plots are drawn as polygons with status-based coloring.
- **Plot details** with customer info, pricing (including scholar-rate views where applicable), EMI schedule UI, remark log, and status context.
- **Bulk selection** (owner / super admin) to inspect multiple plots at once (**Selected Plots Info**).
- **Real-time updates** via WebSocket so the map and lists stay in sync when plots change.
- **Share / export helpers** for layout snapshots and branded location text (maps link, site copy).

### Booking and plot lifecycle (owner & super admin)

- **Waiting list** per plot with ordinals; **booking** flows with payment details.
- **Status changes** such as vacant / transfer-related flows, with validation and audit-oriented messaging.
- **Biometric confirmation** where enabled for sensitive actions.
- **Activity summaries** pushed to CometChat groups for visibility (configurable group IDs).

### Reports and operations

- **Area statement** — aggregated area / allocation style reporting for the project.
- **Waiting list** tab — cross-plot waiting visibility.
- **Balance list** — outstanding balances and payment posture.
- **Activity summary** — searchable, filterable, sortable log (dates, plot order, owner order) with detail panels; optional export-related workflows (spreadsheet / PDF libraries present in the app).

### Accounts and roles

- **Login**, **signup**, **forgot password**, and **pending approval** gate for new users.
- **Roles**: `super_admin`, `owner`, and `guest` with a fixed capability map (edit vs read-only tabs, chat, admin).
- **Admin panel** (super admin): list users, approve / reject signups, cycle roles.

### Chat and notifications

- **CometChat** (UIKit) for **group/community** chat from the layout flow, plus **message search**.
- **Firebase** messaging hooks for **push**; local notification display on Android when configured.
- CometChat **FCM provider ID** wired for dashboard registration.

### UX

- **Light / dark theme** with persisted preference.
- **Profile** with avatar support and account maintenance modals.
- **Server warmup** splash while the API becomes ready.
- Optional **DEV** on-screen badge when `DEV_APP=true` in env (for non-production builds).

---

## Prerequisites

- **Node.js** **22.11+** (see `package.json` `engines`)
- **React Native** **0.84.x** (project version)
- **npm** or **Yarn**

**Android**

- Android Studio, SDK, and an emulator or device (**Android 5.0+** typical minimum for RN; follow current RN docs for API levels)
- **JDK** compatible with the React Native / Gradle toolchain

**iOS** (macOS only)

- **Xcode**
- **CocoaPods** (via Bundler or system install)
- Simulator or device (**iOS 12+** is often the floor for dependencies; use Xcode’s supported deployment target)

**Services**

- A running **Plot Vista backend** reachable from the device or emulator (correct LAN IP or HTTPS URL).
- **CometChat** app (App ID, Region, Auth Key) and groups matching your env (defaults in code: `golden-city`, `golden-city-noti` unless overridden).
- **Firebase** project with `google-services.json` (Android) / `GoogleService-Info.plist` (iOS) as already configured in the repo.

---

## Getting Started

### 1. Clone the repository

From the monorepo root (or your fork):

```bash
git clone <your-repo-url>
cd PlotVista/frontend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Environment variables

Copy the example file and edit values for your machine and CometChat app:

```bash
cp .env.example .env
```

| Variable | Purpose |
|----------|---------|
| `API_URL` | Backend base URL (no trailing slash), e.g. `http://192.168.x.x:5000` for a device on the same Wi‑Fi |
| `COMETCHAT_APP_ID` | CometChat application ID |
| `COMETCHAT_REGION` | CometChat region |
| `COMETCHAT_AUTH_KEY` | CometChat auth key |
| `COMETCHAT_COMMUNITY_GROUP_ID` | Optional; overrides default community group GUID |
| `COMETCHAT_NOTIFICATION_GROUP_ID` | Optional; overrides default notification group GUID |
| `COMETCHAT_FCM_PROVIDER_ID` | FCM provider ID from CometChat dashboard (push) |

For **release** builds, mirror the same keys in `.env.production` as used by `react-native-config`.

Optional:

- `DEV_APP=true` — shows a small **DEV** badge in the app (see `App.tsx`).

Register and create an app in the [CometChat Dashboard](https://app.cometchat.com/) if you have not already.

### 4. iOS — CocoaPods

From `frontend/ios` on first clone or after native dependency changes:

```bash
bundle install   # if the project uses Bundler for CocoaPods
cd ios
bundle exec pod install   # or: pod install
cd ..
```

### 5. Start Metro

From `frontend`:

```bash
npm start
```

### 6. Run the app

**Android** (new terminal, from `frontend`):

```bash
npm run android
```

The project defines **product flavors**. Examples:

```bash
npm run android:dev    # dev debug variant / application id suffix
npm run android:prod   # prod debug variant
```

**iOS**:

```bash
npm run ios
```

If setup is correct, the app opens in the emulator or on a connected device. For physical devices, ensure `API_URL` uses the host machine’s IP (not `localhost` from the phone’s perspective).

---

## Screenshots

Images live in **`Screenshots/`** next to this README. Current files (extensions match what is on disk):

```
frontend/Screenshots/
  login.jpg
  signup.jpg
  pending-approval.png
  master-plan.jpg
  plot-details.jpg
  multi-plot-summary.jpg
  area-statement.jpg
  waiting-list.jpg
  balance-list.jpg
  activity-summary.png
  admin-panel.png
  profile.jpg
  group-chat.jpg
  search-messages.jpg
```

### Authentication and onboarding

| Login | Sign up | Pending approval |
|-------|---------|------------------|
| ![Login](./Screenshots/login.jpg) | ![Sign up](./Screenshots/signup.jpg) | ![Pending approval](./Screenshots/pending-approval.png) |

### Master plan and plots

| Master plan (zoomed) | Plot details | Multi-plot summary |
|----------------------|--------------|-------------------|
| ![Master plan](./Screenshots/master-plan.jpg) | ![Plot details](./Screenshots/plot-details.jpg) | ![Multi-plot summary](./Screenshots/multi-plot-summary.jpg) |

### Operations

| Area statement | Waiting list | Balance list |
|----------------|--------------|--------------|
| ![Area statement](./Screenshots/area-statement.jpg) | ![Waiting list](./Screenshots/waiting-list.jpg) | ![Balance list](./Screenshots/balance-list.jpg) |

| Activity summary | Admin panel | Profile |
|------------------|-------------|---------|
| ![Activity summary](./Screenshots/activity-summary.png) | ![Admin panel](./Screenshots/admin-panel.png) | ![Profile](./Screenshots/profile.jpg) |

### Chat

| Group chat | Search messages |
|------------|-----------------|
| ![Group chat](./Screenshots/group-chat.jpg) | ![Search messages](./Screenshots/search-messages.jpg) |

**File reference**

1. **`login.jpg`** — Login  
2. **`signup.jpg`** — Sign up  
3. **`pending-approval.png`** — Pending approval  
4. **`master-plan.jpg`** — Master plan  
5. **`plot-details.jpg`** — Plot details  
6. **`multi-plot-summary.jpg`** — Multi-plot summary  
7. **`area-statement.jpg`**, **`waiting-list.jpg`**, **`balance-list.jpg`** — Area / waiting / balance  
8. **`activity-summary.png`** — Activity summary  
9. **`admin-panel.png`** — Admin panel  
10. **`profile.jpg`** — Profile  
11. **`group-chat.jpg`**, **`search-messages.jpg`** — Chat & search  

If you replace a file or change its extension, update the matching `./Screenshots/...` line in the tables above.

---

## Tech Stack

- **React Native** 0.84.x, **React** 19.x, **TypeScript** (partial) / JavaScript
- **React Navigation** (native stack + bottom tabs)
- **Axios** + **Socket.IO client** for API and realtime
- **CometChat** Chat SDK + UI Kit
- **Firebase** (app + messaging)
- **Notifee** (local notifications)
- **dayjs**, **react-native-config**, **AsyncStorage**, **biometrics**, image pickers, **view-shot**, **share**, **SVG**, **zoomable view**, **Excel/PDF** libraries for exports

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start Metro bundler |
| `npm run android` | Run default Android debug build |
| `npm run android:dev` | Android dev flavor debug |
| `npm run android:prod` | Android prod flavor debug |
| `npm run android:release` | Example prod release assemble (Windows `gradlew.bat` in script) |
| `npm run ios` | Run iOS build |
| `npm test` | Jest |
| `npm run lint` | ESLint |

---

## Notes

- **Backend required**: Most screens need a live API; map and data load from `API_URL`.
- **CometChat groups** must exist or match the GUIDs you set; otherwise chat init may warn or fail until the dashboard is aligned.
- **Device networking**: Emulators use special IPs for the host machine (`10.0.2.2` on Android emulator, etc.); real devices need your LAN IP in `API_URL`.
- This README describes the **frontend** package only; deploy and database details live with the Plot Vista backend.

---

## Troubleshooting

- Follow the official [React Native environment setup](https://reactnative.dev/docs/set-up-your-environment) if builds fail at the toolchain level.
- If Metro or Gradle cache causes odd errors, clean per RN/Android docs and reinstall `node_modules`.
- For CometChat, confirm **App ID**, **region**, and **auth key** in `.env` match the CometChat app and that push **FCM** is configured if you rely on notifications.
