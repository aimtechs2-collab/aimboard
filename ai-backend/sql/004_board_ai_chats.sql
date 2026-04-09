-- Per-user, per-board AI sidebar chat threads (messages + archived context JSON).

CREATE TABLE IF NOT EXISTS board_ai_chat_sessions (
  id BIGSERIAL PRIMARY KEY,
  board_id BIGINT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Chat',
  context_messages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_board_ai_chat_sessions_board_user_updated
  ON board_ai_chat_sessions(board_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS board_ai_chat_messages (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES board_ai_chat_sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, position)
);

CREATE INDEX IF NOT EXISTS idx_board_ai_chat_messages_session_pos
  ON board_ai_chat_messages(session_id, position);
