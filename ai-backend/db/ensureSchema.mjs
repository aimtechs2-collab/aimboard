import { pgExecute } from "./prismaClient.mjs";

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      clerk_user_id TEXT UNIQUE NOT NULL,
      email TEXT,
      name TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE TABLE IF NOT EXISTS ai_usage_events (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      model TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user_id ON ai_usage_events (user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created_at ON ai_usage_events (created_at DESC);`,
  `CREATE TABLE IF NOT EXISTS api_process_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      clerk_user_id TEXT,
      route TEXT NOT NULL,
      http_method TEXT NOT NULL,
      status_code INTEGER,
      duration_ms INTEGER,
      client_ip TEXT,
      user_agent TEXT,
      error_message TEXT,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE INDEX IF NOT EXISTS idx_api_process_logs_user_id ON api_process_logs (user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_api_process_logs_clerk_user_id ON api_process_logs (clerk_user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_api_process_logs_created_at ON api_process_logs (created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_api_process_logs_route ON api_process_logs (route);`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_api_at TIMESTAMPTZ;`,
  `CREATE TABLE IF NOT EXISTS user_activity_events (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      clerk_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      category TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity_events (user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_user_activity_clerk_user_id ON user_activity_events (clerk_user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity_events (created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_user_activity_action ON user_activity_events (action);`,
  `CREATE TABLE IF NOT EXISTS workspaces (
      id BIGSERIAL PRIMARY KEY,
      owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'My workspace',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(owner_user_id)
    );`,
  `CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_user_id);`,
  `CREATE TABLE IF NOT EXISTS folders (
      id BIGSERIAL PRIMARY KEY,
      workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE INDEX IF NOT EXISTS idx_folders_workspace ON folders(workspace_id);`,
  `CREATE TABLE IF NOT EXISTS boards (
      id BIGSERIAL PRIMARY KEY,
      folder_id BIGINT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Untitled board',
      scene_gzip BYTEA NOT NULL,
      created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE INDEX IF NOT EXISTS idx_boards_folder_updated ON boards(folder_id, updated_at DESC);`,
  `CREATE TABLE IF NOT EXISTS board_ai_chat_sessions (
      id BIGSERIAL PRIMARY KEY,
      board_id BIGINT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Chat',
      context_messages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE INDEX IF NOT EXISTS idx_board_ai_chat_sessions_board_user_updated
    ON board_ai_chat_sessions(board_id, user_id, updated_at DESC);`,
  `CREATE TABLE IF NOT EXISTS board_ai_chat_messages (
      id BIGSERIAL PRIMARY KEY,
      session_id BIGINT NOT NULL REFERENCES board_ai_chat_sessions(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(session_id, position)
    );`,
  `CREATE INDEX IF NOT EXISTS idx_board_ai_chat_messages_session_pos
    ON board_ai_chat_messages(session_id, position);`,
  `ALTER TABLE board_ai_chat_messages ADD COLUMN IF NOT EXISTS images_json JSONB;`,
  `CREATE TABLE IF NOT EXISTS share_links (
      id TEXT PRIMARY KEY,
      payload BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE INDEX IF NOT EXISTS idx_share_links_created_at ON share_links (created_at DESC);`,
  `CREATE TABLE IF NOT EXISTS share_link_files (
      share_id TEXT NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL,
      payload BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (share_id, file_id)
    );`,
  `CREATE INDEX IF NOT EXISTS idx_share_link_files_share_created ON share_link_files (share_id, created_at DESC);`,
];

export async function ensureSchema() {
  if (!process.env.NEON_DATABASE_URL) {
    return;
  }
  for (const sql of SCHEMA_STATEMENTS) {
    await pgExecute(sql);
  }
}
