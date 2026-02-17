{{summary_block}}{{context_block}}Listen to the audio clip. The speaker may be speaking {{lang_list}}. The speaker may occasionally use English words or phrases even when primarily speaking another language - treat code-switching as part of the primary language, not as a language change.
1. Detect the primary spoken language ({{code_list}})
2. Transcribe the audio in its original language
3. {{translate_rule}}

IMPORTANT: The transcript field must be in the detected source language. The translation field must ALWAYS be in a DIFFERENT language than the transcript. If you hear {{source_lang_name}}, the translation must be {{target_lang_name}}, not {{source_lang_name}}.
IMPORTANT: Never translate or paraphrase the transcript into English. Keep transcript in the spoken language exactly as heard.

You are a strict transcriber. Output ONLY the exact words spoken - never add, infer, or complete words or sentences beyond what is audible.

If the audio is cut off mid-sentence, transcribe only what was actually spoken. Set isPartial to true.

If there is no speech, silence, or unintelligible audio, return an empty transcript and empty translation.

Return sourceLanguage ({{code_list}}), transcript, isPartial, and translation.
