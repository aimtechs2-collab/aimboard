# AimBoard

AimBoard is an advanced, open-source collaborative virtual whiteboard designed for modern teams and creators. It combines a beautiful, hand-drawn aesthetic with powerful, real-time AI tools that supercharge brainstorming, planning, and design workflows.

## 🚀 Key Features

*   **Virtual Whiteboard:** Infinite, canvas-based whiteboard with a unique hand-drawn style.
*   **AI-Powered Workflows:**
    *   **Text-to-Diagram:** Instantly generate flowcharts, ER diagrams, and sequence diagrams just by typing a description.
    *   **Diagram-to-Code:** Point your AI assistant at your wireframes to automatically translate them into functional UI code.
    *   **Smart AI Sidebar Chat:** A persistent context-aware assistant that tracks your canvas modifications and helps brainstorm ideas.
*   **Workspace & Folder Management:** An intuitive dashboard with optimistic UI updates for lightning-fast creation and organization of your boards.
*   **Real-time Collaboration:** Work flawlessly together with your team entirely in-sync with robust session handling.
*   **Secure Authentication:** Securely gated access and user management powered by Clerk.

## 🏗️ Technical Architecture

AimBoard is built as a complete Full-Stack Monorepo.

### Frontend (`/excalidraw-app`)
*   **Framework:** React (Vite)
*   **Language:** TypeScript
*   **State & Data:** Highly optimized Optimistic UI.

### AI Backend (`/ai-backend`)
*   **Runtime:** Node.js (Express)
*   **Database:** PostgreSQL (with Prisma ORM)
*   **AI Integrations:** Native OpenAI and Ollama hooks for generating deep insights.
*   **Security & Auditing:** Comprehensive API logging, request auditing, and rate-limiting using `pg-pool` and custom middleware.

## 📦 Getting Started

### Prerequisites
*   Node.js (>= 18.0.0)
*   Yarn or npm
*   A PostgreSQL Database (e.g., Neon)
*   Clerk Account (for Auth API Keys)
*   OpenAI API Key

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/aimtechs2-collab/aimboard.git
   cd aimboard
   ```

2. **Install dependencies:**
    ```bash
    yarn clean-install
    ```

3. **Set up environment variables:**
    Copy `.env.example` to `.env.development.local` and fill in your keys:
    ```ini
    VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
    CLERK_SECRET_KEY=sk_test_...
    VITE_APP_AI_BACKEND=http://localhost:3016
    NEON_DATABASE_URL=postgresql://...
    OPENAI_API_KEY=sk-...
    ```

### Running Locally

You can spin up the full stack using Yarn workspaces.

**Start the Frontend:**
```bash
yarn build:packages
yarn start
```

**Start the Backend:**
```bash
cd ai-backend
npm start
```

## 🚀 Deployment

*   **Frontend:** Optimized for drop-in deployment to **Vercel** via the built-in `vercel.json` configuration.
*   **Backend:** Easily deployable to **Render** as a Node.js web service. Set the root directory to `ai-backend`.

## 📄 License & Contributing
AimBoard is released under the MIT license. PRs and improvements are always welcome!
