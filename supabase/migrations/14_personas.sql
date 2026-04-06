-- ============================================================================
-- Personas Feature
-- User can create multiple personas (character profiles for themselves)
-- and select one when starting a chat
-- ============================================================================

-- Create personas table
CREATE TABLE IF NOT EXISTS public.personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT personas_name_length CHECK (char_length(name) >= 1 AND char_length(name) <= 100),
  CONSTRAINT personas_description_length CHECK (description IS NULL OR (char_length(description) >= 1 AND char_length(description) <= 5000))
);

-- Add persona_id to chats table (nullable - persona is optional)
ALTER TABLE public.chats
ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES public.personas(id) ON DELETE SET NULL;

-- Create index for faster persona lookups
CREATE INDEX IF NOT EXISTS idx_personas_user_id ON public.personas(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_persona_id ON public.chats(persona_id);

-- Enable RLS
ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;

-- RLS Policies for personas
CREATE POLICY "Users can view their own personas"
  ON public.personas
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own personas"
  ON public.personas
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own personas"
  ON public.personas
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own personas"
  ON public.personas
  FOR DELETE
  USING (auth.uid() = user_id);

-- Updated_at trigger for personas
CREATE OR REPLACE FUNCTION public.update_personas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_personas_updated_at
  BEFORE UPDATE ON public.personas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_personas_updated_at();

-- Comments
COMMENT ON TABLE public.personas IS 'User-created persona profiles for roleplay';
COMMENT ON COLUMN public.personas.name IS 'Short name for the persona (e.g., "Student Mode", "Office Worker")';
COMMENT ON COLUMN public.personas.description IS 'Free-text description of the persona (name, age, appearance, personality, etc.)';
COMMENT ON COLUMN public.chats.persona_id IS 'Optional persona used in this chat';
