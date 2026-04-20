# AimBoard

<div align="center">
  <h2>
    The Next-Generation Collaborative AI Whiteboard
  </h2>
  <p>An open-source, hand-drawn style infinite canvas powered by advanced AI workflows, seamless collaboration, and robust workspaces.</p>
</div>

---

## 🌟 Vision & Overview

AimBoard bridges the gap between chaotic brainstorming and structured engineering. It allows teams to freely sketch, plan, and wireframe their ideas on an infinite canvas, while tightly integrating AI assistants directly into the workflow natively. 

Whether you need to generate a mermaid diagram from text, translate a UI wireframe directly into React code, or bounce ideas off a context-aware chat assistant, AimBoard acts as the ultimate design and thinking surface for engineering teams and digital creators.

---

## ✨ Features Deep-Dive

### 🎨 The Virtual Canvas
*   **Infinite Space:** A limitless boundary board that expands as your ideas grow.
*   **Hand-Drawn Aesthetics:** Unique, organic shape rendering.
*   **Extensive Toolset:** Free-draw, bounding boxes, text blocks, embedded images, customizable arrows, and geometric shape primitives.
*   **Export Ready:** Instantly capture the viewport or specific shapes to PNG, SVG, or Clipboard data.

### 🤖 Built-in AI Capabilities
*   **Smart Sidebar Chat:** A dedicated AI context window that is fully aware of your board contents. Discuss ideas, ask for structural improvements, and review iterations.
*   **Text-to-Diagram:** Describe complex software architecture or logic flows, and AimBoard's AI automatically renders Mermaid diagrams onto your canvas.
*   **Diagram-to-Code:** Select UI elements or wireframes on your board and let the AI instantly translate those shapes into fully functional code (HTML/CSS/React).

### 🗂️ Workspace & Organization
*   **Multi-Workspace Architecture:** Separate your personal scratchpads from team projects.
*   **Folders & Boards Management:** A highly optimized dashboard designed with Optimistic UI updates. Folders and Boards generate without waiting for backend round-trips for the fastest UX possible.
*   **Deep Linking:** Secure links connecting specific Boards and AI sessions.

### 🔐 Security & Operations
*   **User Authentication:** Fully managed JWT-based authorization powered by Clerk.
*   **End-to-End Persistence:** Automatically saves encrypted blobs of your Whiteboard (via gzip compression) to a high-performance PostgreSQL backbone.
*   **Usage Tracking & Auditing:** Comprehensive database logging that tracks AI usage (tokens) and API response bottlenecks.

---

## 🏗️ Monorepo Architecture

AimBoard is built as a complete Full-Stack Monorepo utilizing Yarn Workspaces to seamlessly share interfaces and components.

### 1. The Frontend UI (`/excalidraw-app`)
*   **Engine:** React running on Vite.
*   **Language:** Strict TypeScript.
*   **State Management:** React Context & Optimistic UI hydration.
*   **Style:** SCSS & CSS Modules.

### 2. The AI Backend (`/ai-backend`)
*   **Engine:** Node.js powered by Express.
*   **Database Schema:** Managed by Prisma ORM communicating with PostgreSQL.
*   **LLM Orchestration:** Direct pipelines to OpenAI and Ollama.
*   **Middleware:** Advanced Rate-limiting (via `express-rate-limit`), CORS enforcement, Security headers (`helmet`), and asynchronous audit tracking (`logProcessEntry`).

---

## 📂 Directory Structure

```text
aimboard/
├── ai-backend/            # Express Node.js Server & Database Layer
│   ├── controllers/       # Route logic for users, boards, AI chats
│   ├── middleware/        # Auditing, Rate-limiting, Error capturing
│   ├── prisma/            # Database schema and migrations
│   └── server.mjs         # API Entrypoint
├── excalidraw-app/        # Main Frontend Dashboard & Canvas Application
├── packages/              # Shared libraries (Whiteboard Engine, Math Utilities)
├── public/                # Static assets, fonts, icons
├── scripts/               # Global build tools and release automation
├── package.json           # Monorepo root and workspace definitions
└── vercel.json            # Vercel deployment configuration
```

---

## 🚀 Getting Started Locally

### Prerequisites
*   **Node.js** (>= 18.0.0)
*   **Yarn** Package Manager
*   **PostgreSQL** (We recommend Neon.tech for quick serverless databases)
*   **Clerk** Account for Authentication
*   **OpenAI** API Key

### 1. Installation
Clone the repository and install all workspace dependencies:
```bash
git clone https://github.com/aimtechs2-collab/aimboard.git
cd aimboard
yarn clean-install
```

### 2. Environment Setup
You will need to construct local environment variables. At the root of the project, create a file named `.env.development.local` and add the following keys:

```ini
# --- Frontend Keys ---
# Clerk Publishable Key for UI Authentication
VITE_CLERK_PUBLISHABLE_KEY=pk_test_... 
# Points the Frontend to your local Node server
VITE_APP_AI_BACKEND=http://localhost:3016

# --- Backend Keys ---
# Clerk Secret Key to verify JWT tokens
CLERK_SECRET_KEY=sk_test_...
# Your PostgreSQL connection string
NEON_DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
# OpenAI configuration for AI features
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

### 3. Running the Stack

You need to run both the Frontend and the Backend concurrently during development.

**Terminal 1: Start the Frontend UI**
```bash
# Build the shared packages first
yarn build:packages
# Start the Vite development server
yarn start
```

**Terminal 2: Start the AI Backend**
```bash
cd ai-backend
npm start
```
Your frontend will now be available at `http://localhost:3000` (or whichever port Vite binds to), seamlessly communicating with your API at `http://localhost:3016`.

---

## ☁️ Deployment Guide

AimBoard is pre-configured for modern serverless hosting.

### Deploying Frontend to Vercel
The frontend configuration is already written in `vercel.json`.
1. Connect your Github Repository to Vercel.
2. Vercel will automatically detect the build settings based on the root `package.json`.
3. Add your `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_APP_AI_BACKEND` (which should point to your live backend URL) in the Vercel Environment Variables Console.
4. Deploy.

### Deploying Backend to Render
1. Create a **New Web Service** in Render and connect your GitHub repo.
2. Under "Root Directory", type exactly `ai-backend`.
3. Set the **Build Command** to: `yarn install --ignore-scripts` *(This is important to skip local dev-hooks like Husky).*
4. Set the **Start Command** to: `npm start`.
5. Add all server environment variables (`NEON_DATABASE_URL`, `OPENAI_API_KEY`, etc.) in the Render dashboard.
6. Deploy.

---

## 🤝 Contributing & Support

We welcome contributions!
If you find a bug or want to suggest a new feature, please open an Issue or submit a Pull Request directly on our GitHub page. 

**Code Guidelines:**
* Always run `yarn test:code` and `yarn fix:code` (ESLint) before committing.
* Ensure Prisma schema modifications are pushed correctly to the tracking database.

### License
AimBoard is released under the MIT License.
