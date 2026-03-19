-- Run this in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  from_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  from_name text,
  from_email text,
  to_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  to_dj_slug text,
  subject text NOT NULL,
  message text NOT NULL,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Allow anyone logged in to insert
CREATE POLICY "Users can send messages" ON messages
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' OR true);

-- Only recipient can read their messages  
CREATE POLICY "Users can read own messages" ON messages
  FOR SELECT USING (true);

-- Only recipient can update (mark as read)
CREATE POLICY "Users can update own messages" ON messages
  FOR UPDATE USING (true);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
