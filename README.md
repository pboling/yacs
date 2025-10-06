# YACS - Yet Another Crypto Scanner

💫 Alternative Front End Demo 💫

💫 Faux REST and WebSocket Backends for Testing 💫

[![CI](https://github.com/pboling/yacs/actions/workflows/ci.yml/badge.svg)](https://github.com/pboling/yacs/actions/workflows/ci.yml) [![Deploy](https://github.com/pboling/yacs/actions/workflows/deploy.yml/badge.svg)](https://github.com/pboling/yacs/actions/workflows/deploy.yml) [![Live Demo][demo-img]][demo]

[demo]: https://pboling.github.io/yacs/
[demo-img]: https://img.shields.io/badge/Live-Demo-blue

- ✅️ Original website 👉️️ https://www.dexcelerate.com/
- ⚠️ WARNING ⚠️ This demo site can mix **mock/fake data** with real-time data from the [DEX Scanner API](https://www.dexcelerate.com/)
- ⏳️ Why? ⏳️ This is a [live demo][demo] of what local dev could be like if you hire me!

| Theme: Cherry Sour                                    | Theme: Rocket Lake (a11y accessible)                  | Theme: Legendary (a11y accessible)              | Detail (Chart) Modal                               |
|-------------------------------------------------------|-------------------------------------------------------|-------------------------------------------------|----------------------------------------------------|
| Not pictured: detail row with social links            | Not pictured: detail row with social links            | Not pictured: detail row with social links      |                                                    |
| [![yacs-theme-cherry-sour][cherry-sour]][cherry-sour] | [![yacs-theme-rocket-lake][rocket-lake]][rocket-lake] | [![yacs-theme-legendary][legendary]][legendary] | [![yacs-detail-modal][detail-modal]][detail-modal] |

[cherry-sour]: https://github.com/user-attachments/assets/e81d370b-1476-4db0-93b2-d7c0371fef93
[rocket-lake]:https://github.com/user-attachments/assets/52e2b7a0-3ab4-4b22-882c-dc0b0a9cb68f
[legendary]: https://github.com/user-attachments/assets/8067b114-5ce9-402c-bd8d-aceb7df2f33f
[detail-modal]: https://github.com/user-attachments/assets/b2d4b02b-275b-4263-8a64-00766b4d3680

## Overview

This app is a single-page React application (Rolldown-Vite-based) designed to display and manage real-time token data.
It features robust filtering, sorting, and live updates via WebSocket, with a focus on usability and responsiveness.

## Technical Approach

### Dependencies

Only four runtime dependencies are used, to limit the attack surface, the bug surface,
maximize performance with browser native tools, and leverage cross compatibility:

- @tanstack/react-virtual - rows outside the view become viewtualized, but still attacked to their hooks and events; some have conditions on whether they are visible.
- lucide-react - lightweight SVG icon library.
- react - No time for an essay here, but it's React, and you've already heard of it.
- react-dom - React DOM bindings.

🎉 No additional Javascript libraries are used.
🎉 No CSS frameworks are used.

### Real-time Updates

- **WebSocket Subscription:** The app subscribes to relevant WebSocket events to receive live updates for token price, volume, and new token additions.
- **Dynamic Data Handling:** Token data is updated in real-time, with sorting and filtering maintained as new data arrives.
- **Efficient State Management:** Ensures UI remains consistent and performant during frequent updates.
- **Real-time Performance:** Can handle 50,000 web socket updates per minute (I stopped testing there, might handle more!).

### Filtering & Sorting

- **Client-side Filtering:** Users can filter tokens by chain (ETH, SOL, BASE, BSC), minimum volume, maximum age, minimum market cap, and exclude honeypots.
- **Server-side Sorting:** Client side sorting for speed.
- **Responsive Controls:** Filtering controls are intuitive and update the table instantly.

### UI/UX

- **Loading States:** Visual indicators during data fetches and updates.
- **Error States:** Clear messaging and recovery options for API/WebSocket errors.
- **Empty States:** Informative UI when no tokens match the filters.
- **Color Coding:** Price changes are color-coded and themaable (e.g., green for up, red for down) for quick visual feedback.
- **A11y (Accessibility):** Entire app is themed with multiple themes friendly to colorblind users (orange/blue, yellow/purple).

## Main Features

1. **React App:** Runnable SPA with tables and filters.
2. **API Integration:** REST API calls for initial and filtered data.
3. **WebSocket Integration:** Real-time updates for token data.
4. **Styling:** Clean, modern UI with flexible styling options.
5. **Documentation:** This README, [DETAILS.md](DETAILS.md), unit and e2e tests, and in-code comments.
6. **Error Handling:** Robust error states and recovery mechanisms.

## Bonus Features

- **Unit Tests:** Node tests for coverage of key components and logic.
- **Integration Tests:** Vitest for key component integrations and behaviors.
- **E2E Tests:** Coverage for full stack functionality, via playwright.
- **Mock Server Backend:** Tests run against a mock server, fixtures, or configurable live server.
- **Mock Server Frontend:** Auto Tick feature to allow front-end realism when the WebSocket isn't pushing events. (NOTE: This is an interface demo, not a real product!)
- **Websocket Console:** Debug tool for tracking outgoing and incoming WebSocket messages.
- **WS Subscription Throttle:** Test the limits of performance.
- **Per-Row Manual WS Subscription:** Each row can have its subscriptions turned off and on (sticky).
- **Fresh column:** Sort by data freshness, rows pop to the top of the table when they receive updates.
- **WS Subscription Monitoring:** Various debug tools, and hidden URL params, provide additional console logging, and visibility into the WebSocket connection.
- **WS Subscription Management:** Subscriptions are managed to ensure visible rows are always subscribed, and a dynamically-resized and throttled FIFO stack limits the window of subscriptions for rows outside scrollpanes.
- **Chart Integration:** Mini price charts for tokens, and large price charts in a Detail / Compare modal.
- **Export Functionality:** Export token data as CSV for analysis.
- **Advanced Filtering:** Additional controls for power users.

## Getting Started

1. Install dependencies: `pnpm install`
2. Start the app: `pnpm run dev`, or to run the local mock server as well: `pnpm run dev:serve`
3. Run tests: `pnpm test`

## Development modes and environment flags

This project supports flexible local setups via a few environment variables. Put them in `.env.local` (the repo uses shell-style `export` lines, friendly to direnv) and restart the dev server after changes.

### Dev modes

- `pnpm run dev`
  - Starts only the Vite dev server.
  - REST: defaults to the public API unless you set `VITE_API_BASE`.
  - WebSocket: tries endpoints in this order: `/ws` (Vite proxy, dev only) → `VITE_WS_URL` → production `wss://api-rs.dexcelerate.com/ws`.
- `pnpm run dev:serve`
  - Starts the local Express mock backend and Vite together.
  - Vite proxies:
    - `/scanner` → `http://localhost:3001`
    - `/ws` → `ws://localhost:3001/ws`
  - If you set `VITE_API_BASE="/"`, REST requests hit the Vite proxy. Otherwise, an absolute `VITE_API_BASE` (e.g., `http://localhost:8000`) bypasses the proxy and talks directly to that host.

### Flags

- `VITE_API_BASE`
  - Controls the REST base URL used by the app when calling `GET /scanner`.
  - Default: `https://api-rs.dexcelerate.com`
  - Common setups:
    - Use Vite proxy (works best with `dev:serve`):
      ```bash
      export VITE_API_BASE="/"
      ```
    - Point at a local server directly (bypasses Vite proxy):
      ```bash
      export VITE_API_BASE="http://localhost:8000"
      ```
- `VITE_WS_URL`
  - (Optional) Override the WebSocket endpoint explicitly.
  - Example:
    ```bash
    export VITE_WS_URL="ws://localhost:9000/ws"
    ```
  - In dev, the connection order is: `/ws` → `VITE_WS_URL` → production. Set this to force a specific WS server without changing code.
- `VITE_DISABLE_WS`
  - Disable all WebSocket behavior (no connection attempts, no fallbacks, no reuse).
  - Accepts typical truthy values: `1`, `true`, `yes`, `on`.
  - Example:
    ```bash
    export VITE_DISABLE_WS=1
    ```
  - Useful for testing REST-only behavior, or preventing a fallback to the production WS when no local WS is running.
  - Allows for experimentation with the faux events that can be triggered in the UI, without data mixing from the real WS.

> After editing `.env.local`, run `direnv allow` and restart the dev server so Vite picks up the changes.

## © Copyright

<ul>
    <li>
        Copyright (c) 2025 Peter H. Boling
        <a href="https://discord.gg/3qme4XHNKN">
             - Galtzo.com
            <picture>
              <img src="https://logos.galtzo.com/assets/images/galtzo-floss/avatar-128px-blank.svg" alt="Galtzo.com Logo (Wordless) by Aboling0, CC BY-SA 4.0" width="24">
            </picture>
        </a>.
    </li>
</ul>

## License

This code is licensed under [CC BY-NC-SA](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en). If you'd like to use it in another way, please contact me.
I may change the license in the future.

Lucide Icons are either ISC or MIT license - https://lucide.dev/license

---

For more details, see [DETAILS.md](DETAILS.md), inline documentation, and tests.
