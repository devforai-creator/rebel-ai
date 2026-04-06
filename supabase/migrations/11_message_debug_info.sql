/**
 * Add debug_info to messages table for LLM I/O logging
 *
 * Stores detailed information for debugging:
 * - Full prompt sent to LLM
 * - Raw LLM response (before regex processing)
 * - Processed response (after regex)
 * - Model configuration used
 */

-- Add debug_info column to messages table
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS debug_info jsonb DEFAULT NULL;

-- Comment
COMMENT ON COLUMN messages.debug_info IS
  'Debug information: {prompt, rawResponse, processedResponse, modelConfig, timestamp}';
