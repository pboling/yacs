# Dexcelerate FE Test

## Overview
This app is a single-page React application (Rolldown-Vite-based) designed to display and manage real-time token data.
It features robust filtering, sorting, and live updates via WebSocket, with a focus on usability and responsiveness.

## Technical Approach

### Real-time Updates
- **WebSocket Subscription:** The app subscribes to relevant WebSocket events to receive live updates for token price, volume, and new token additions.
- **Dynamic Data Handling:** Token data is updated in real-time, with sorting and filtering maintained as new data arrives.
- **Efficient State Management:** Ensures UI remains consistent and performant during frequent updates.
- **Real-time Performance:** Can handle 50,000 web socket updates per minute (I stopped testing there, might handle more!).

### Filtering & Sorting
- **Client-side Filtering:** Users can filter tokens by chain (ETH, SOL, BASE, BSC), minimum volume, maximum age, minimum market cap, and exclude honeypots.
- **Server-side Sorting:** Sorting is performed via API parameters for scalability and accuracy.
- **Responsive Controls:** Filtering controls are intuitive and update the table instantly.

### UI/UX
- **Loading States:** Visual indicators during data fetches and updates.
- **Error States:** Clear messaging and recovery options for API/WebSocket errors.
- **Empty States:** Informative UI when no tokens match the filters.
- **Color Coding:** Price changes are color-coded (green for up, red for down) for quick visual feedback.
- **A11y (Accessibility)** Entire app is themed with multiple themes friendly to colorblind users.

## Main Features
1. **React App:** Runnable SPA with tables and filters.
2. **API Integration:** REST API calls for initial and filtered data.
3. **WebSocket Integration:** Real-time updates for token data.
4. **Styling:** Clean, modern UI with flexible styling options.
5. **Documentation:** This README and in-code comments.
6. **Error Handling:** Robust error states and recovery mechanisms.

## Bonus Features
- **Unit Tests:** Coverage for key components and logic.
- **Chart Integration:** Mini price charts for tokens, and large price charts in a Detail / Compare modal.
- **Export Functionality:** Export token data as CSV for analysis.
- **Advanced Filtering:** Additional controls for power users.

## Getting Started
1. Install dependencies: `pnpm install`
2. Start the app: `pnpm run dev`, or to run the local mock server as well: `pnpm run dev:serve`
3. Run tests: `pnpm test`

---

For more details, see [DETAILS.md](DETAILS.md), inline documentation, and tests.

