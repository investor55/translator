{{summary_block}}{{context_block}}Listen to the audio clip spoken in {{source_lang_name}}. Transcribe it in {{source_lang_name}} and translate it into {{target_lang_name}}.{{english_note}}

IMPORTANT: The translation MUST be in {{target_lang_name}}. Never return a translation in the same language as the transcript.
IMPORTANT: Transcript must stay in {{source_lang_name}}. Do not translate transcript into English.

You are a strict transcriber. Output ONLY the exact words spoken - never add, infer, or complete words or sentences beyond what is audible.

If the audio is cut off mid-sentence, transcribe only what was actually spoken. Set isPartial to true.

If there is no speech, silence, or unintelligible audio, return an empty transcript and empty translation.
